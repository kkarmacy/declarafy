import base64
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from staging_preflight import run_preflight


def keyring():
    return json.dumps({"stage-key": base64.b64encode(b"s" * 32).decode("ascii")})


class StagingPreflightTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.data.mkdir(mode=0o700)
        self.token = self.root / "worker-token"
        self.token.write_text("t" * 64, encoding="utf-8")
        self.token.chmod(0o600)
        self.keys = self.root / "keyring.json"
        self.keys.write_text(keyring(), encoding="utf-8")
        self.keys.chmod(0o600)
        self.env = patch.dict(os.environ, {
            "WORKER_DATA_DIR": str(self.data),
            "DECLARAFY_WORKER_TOKEN_FILE": str(self.token),
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON_FILE": str(self.keys),
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "stage-key",
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": "",
        }, clear=True)
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_valid_secrets_and_private_storage_pass(self):
        report = run_preflight()
        self.assertTrue(report["ready_for_synthetic_staging_checks"])
        self.assertEqual([x["status"] for x in report["checks"]], ["pass"] * 3)

    def test_world_readable_token_fails(self):
        self.token.chmod(0o644)
        report = run_preflight()
        self.assertFalse(report["ready_for_synthetic_staging_checks"])
        self.assertIn("permissions", report["checks"][0]["reason"])

    def test_symlinked_keyring_fails(self):
        target = self.root / "real-keyring.json"
        target.write_text(keyring(), encoding="utf-8")
        target.chmod(0o600)
        self.keys.unlink()
        self.keys.symlink_to(target)
        report = run_preflight()
        self.assertFalse(report["ready_for_synthetic_staging_checks"])
        self.assertIn("symlink", report["checks"][1]["reason"])

    def test_invalid_keyring_fails_without_disclosing_material(self):
        self.keys.write_text("not-json", encoding="utf-8")
        self.keys.chmod(0o600)
        report = run_preflight()
        self.assertFalse(report["ready_for_synthetic_staging_checks"])
        rendered = json.dumps(report)
        self.assertNotIn("not-json", rendered)

    def test_permissive_data_directory_fails(self):
        self.data.chmod(0o755)
        report = run_preflight()
        self.assertFalse(report["ready_for_synthetic_staging_checks"])
        self.assertIn("0700", report["checks"][2]["reason"])

    def test_world_readable_wal_sidecar_fails(self):
        database = self.data / "jobs.sqlite3"
        with sqlite3.connect(database) as conn:
            conn.execute("CREATE TABLE jobs (job_id TEXT, payload_json TEXT, result_json TEXT)")
            conn.execute("INSERT INTO jobs VALUES ('job-1', 'enc:v1:stage-key:opaque', NULL)")
        database.chmod(0o600)
        wal = Path(str(database) + "-wal")
        wal.write_bytes(b"synthetic wal")
        wal.chmod(0o644)
        report = run_preflight()
        self.assertFalse(report["ready_for_synthetic_staging_checks"])
        self.assertIn("sidecar permissions", report["checks"][2]["reason"])

    def test_existing_database_without_jobs_table_fails(self):
        database = self.data / "jobs.sqlite3"
        with sqlite3.connect(database) as conn:
            conn.execute("CREATE TABLE unrelated (value TEXT)")
        database.chmod(0o600)
        report = run_preflight()
        self.assertFalse(report["ready_for_synthetic_staging_checks"])
        self.assertIn("jobs table is missing", report["checks"][2]["reason"])

    def test_plaintext_legacy_queue_rows_fail(self):
        database = self.data / "jobs.sqlite3"
        with sqlite3.connect(database) as conn:
            conn.execute("CREATE TABLE jobs (job_id TEXT, payload_json TEXT, result_json TEXT)")
            conn.execute("INSERT INTO jobs VALUES ('job-1', '{\"sensitive\":true}', NULL)")
        database.chmod(0o600)
        report = run_preflight()
        self.assertFalse(report["ready_for_synthetic_staging_checks"])
        self.assertIn("legacy/plaintext", report["checks"][2]["reason"])

    def test_encrypted_queue_database_passes_read_only_check(self):
        database = self.data / "jobs.sqlite3"
        with sqlite3.connect(database) as conn:
            conn.execute("CREATE TABLE jobs (job_id TEXT, payload_json TEXT, result_json TEXT)")
            conn.execute("INSERT INTO jobs VALUES ('job-1', 'enc:v1:stage-key:opaque', NULL)")
        database.chmod(0o600)
        report = run_preflight()
        self.assertTrue(report["ready_for_synthetic_staging_checks"])


if __name__ == "__main__":
    unittest.main()
