import base64
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from encryption import (
    EncryptedDataError,
    EncryptionConfigurationError,
    decrypt_field,
    encrypt_field,
)


def encoded_key(byte):
    return base64.b64encode(bytes([byte]) * 32).decode("ascii")


class EncryptionTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": json.dumps({"key-a": encoded_key(1)}),
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "key-a",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_round_trip_and_random_nonce(self):
        first = encrypt_field("job-123", "payload_json", '{"secret":"synthetic"}')
        second = encrypt_field("job-123", "payload_json", '{"secret":"synthetic"}')
        self.assertNotEqual(first, second)
        self.assertEqual(decrypt_field("job-123", "payload_json", first), '{"secret":"synthetic"}')

    def test_ciphertext_is_bound_to_job_and_column(self):
        envelope = encrypt_field("job-123", "payload_json", '{"x":1}')
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-456", "payload_json", envelope)
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-123", "result_json", envelope)

    def test_tampering_fails_authentication(self):
        envelope = encrypt_field("job-123", "result_json", '{"x":1}')
        index = len("enc:v1:key-a:") + 4
        replacement = "A" if envelope[index] != "A" else "B"
        tampered = envelope[:index] + replacement + envelope[index + 1:]
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-123", "result_json", tampered)

    def test_missing_key_configuration_fails_closed(self):
        with patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": "",
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "",
        }):
            with self.assertRaises(EncryptionConfigurationError):
                encrypt_field("job-123", "payload_json", "{}")

    def test_key_rotation_reads_old_and_writes_new(self):
        old = encrypt_field("job-123", "payload_json", '{"x":1}')
        with patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": json.dumps({
                "key-a": encoded_key(1), "key-b": encoded_key(2)
            }),
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "key-b",
        }):
            new = encrypt_field("job-123", "payload_json", '{"x":2}')
            self.assertTrue(new.startswith("enc:v1:key-b:"))
            self.assertEqual(decrypt_field("job-123", "payload_json", old), '{"x":1}')
            self.assertEqual(decrypt_field("job-123", "payload_json", new), '{"x":2}')

    def test_legacy_plaintext_is_rejected_not_silently_read(self):
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-123", "payload_json", '{"legacy":"plaintext"}')


    def test_legacy_migration_dry_run_and_backup_apply(self):
        import migrate_encryption
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "jobs.sqlite3"
            with sqlite3.connect(database) as connection:
                connection.execute("""CREATE TABLE jobs (
                    job_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL, result_json TEXT
                )""")
                connection.execute(
                    "INSERT INTO jobs VALUES (?, ?, ?)",
                    ("job-migrate-0001", '{"tax":"synthetic"}', '{"answer":"synthetic"}'),
                )
            with patch.object(migrate_encryption, "DB_PATH", database), patch.object(migrate_encryption, "APP_DIR", root):
                count, backup = migrate_encryption.migrate(apply=False)
                self.assertEqual(count, 1)
                self.assertIsNone(backup)
                count, backup = migrate_encryption.migrate(apply=True)
                self.assertEqual(count, 1)
                self.assertIsNotNone(backup)
                self.assertTrue(backup.exists())
                self.assertEqual(backup.stat().st_mode & 0o777, 0o600)
                with sqlite3.connect(database) as connection:
                    payload, result = connection.execute(
                        "SELECT payload_json, result_json FROM jobs WHERE job_id=?",
                        ("job-migrate-0001",),
                    ).fetchone()
                self.assertTrue(payload.startswith("enc:v1:"))
                self.assertTrue(result.startswith("enc:v1:"))
                self.assertEqual(decrypt_field("job-migrate-0001", "payload_json", payload), '{"tax":"synthetic"}')
                self.assertEqual(decrypt_field("job-migrate-0001", "result_json", result), '{"answer":"synthetic"}')
                with patch.dict(os.environ, {
                    "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": json.dumps({
                        "key-a": encoded_key(1), "key-b": encoded_key(2)
                    }),
                    "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "key-b",
                }):
                    count, rotated_backup = migrate_encryption.migrate(apply=True)
                    self.assertEqual(count, 1)
                    self.assertTrue(rotated_backup.exists())
                    with sqlite3.connect(database) as connection:
                        rotated_payload, rotated_result = connection.execute(
                            "SELECT payload_json, result_json FROM jobs WHERE job_id=?",
                            ("job-migrate-0001",),
                        ).fetchone()
                    self.assertTrue(rotated_payload.startswith("enc:v1:key-b:"))
                    self.assertTrue(rotated_result.startswith("enc:v1:key-b:"))
                    self.assertEqual(decrypt_field("job-migrate-0001", "payload_json", rotated_payload), '{"tax":"synthetic"}')
                    self.assertEqual(decrypt_field("job-migrate-0001", "result_json", rotated_result), '{"answer":"synthetic"}')
                    count, _ = migrate_encryption.migrate(apply=True)
                    self.assertEqual(count, 0)


    def test_migration_adds_result_column_for_older_queue_schema(self):
        import migrate_encryption
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "jobs.sqlite3"
            with sqlite3.connect(database) as connection:
                connection.execute("""CREATE TABLE jobs (
                    job_id TEXT PRIMARY KEY, payload_json TEXT NOT NULL
                )""")
                connection.execute(
                    "INSERT INTO jobs VALUES (?, ?)",
                    ("legacy-schema-job-0001", '{"input":"synthetic"}'),
                )
            with patch.object(migrate_encryption, "DB_PATH", database), patch.object(migrate_encryption, "APP_DIR", root):
                count, dry_run_backup = migrate_encryption.migrate(apply=False)
                self.assertEqual(count, 1)
                self.assertIsNone(dry_run_backup)
                with sqlite3.connect(database) as connection:
                    before_columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
                self.assertNotIn("result_json", before_columns)
                count, backup = migrate_encryption.migrate(apply=True)
                self.assertEqual(count, 1)
                self.assertTrue(backup.exists())
                with sqlite3.connect(database) as connection:
                    columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
                    payload, result = connection.execute(
                        "SELECT payload_json, result_json FROM jobs WHERE job_id=?",
                        ("legacy-schema-job-0001",),
                    ).fetchone()
                self.assertIn("result_json", columns)
                self.assertIsNone(result)
                self.assertEqual(decrypt_field("legacy-schema-job-0001", "payload_json", payload), '{"input":"synthetic"}')


if __name__ == "__main__":
    unittest.main()
