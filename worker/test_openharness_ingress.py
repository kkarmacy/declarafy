import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
import sqlite3
from pathlib import Path
from fastapi.testclient import TestClient

_tmp = tempfile.TemporaryDirectory()
os.environ["WORKER_DATA_DIR"] = _tmp.name
os.environ["DECLARAFY_WORKER_TOKEN"] = "test-token-" + ("x" * 40)

from openharness_ingress import app  # noqa: E402

client = TestClient(app)
AUTH = {"Authorization": "Bearer " + os.environ["DECLARAFY_WORKER_TOKEN"]}


class WorkerIngressTests(unittest.TestCase):
    def setUp(self):
        db_path = Path(_tmp.name) / "jobs.sqlite3"
        if db_path.exists():
            db_path.unlink()

    def request_body(self, task="tax_question", data=None, request_id="a" * 32):
        if data is None:
            data = {"question": "¿Cuál es la tasa aplicable?"}
        return {"task": task, "input": data, "request_id": request_id, "user_ref": "test-user-1"}

    def test_health_never_claims_execution(self):
        response = client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["execution"], "disabled")

    def test_database_storage_permissions_are_private(self):
        import stat
        import openharness_ingress

        connection = openharness_ingress.db()
        connection.close()
        directory_mode = stat.S_IMODE(Path(_tmp.name).stat().st_mode)
        database_mode = stat.S_IMODE((Path(_tmp.name) / "jobs.sqlite3").stat().st_mode)
        self.assertEqual(directory_mode, 0o700)
        self.assertEqual(database_mode, 0o600)

    def test_sqlite_wal_and_shm_permissions_are_private(self):
        import stat
        import openharness_ingress

        connection = openharness_ingress.db()
        try:
            connection.execute(
                "INSERT INTO jobs (job_id, request_id, user_ref, task, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)",
                ("wal-permission-job", "a" * 32, "owner", "tax_question", '{"question":"x"}', 1),
            )
            connection.commit()
            openharness_ingress.restrict_storage_permissions()
            for suffix in ("-wal", "-shm"):
                sidecar = Path(str(Path(_tmp.name) / "jobs.sqlite3") + suffix)
                self.assertTrue(sidecar.exists(), f"expected SQLite {suffix} sidecar")
                self.assertEqual(stat.S_IMODE(sidecar.stat().st_mode), 0o600)
        finally:
            connection.close()

    def test_authentication_is_required(self):
        response = client.post("/v1/jobs", json=self.request_body())
        self.assertEqual(response.status_code, 401)

    def test_valid_task_is_durably_queued_but_not_executed(self):
        response = client.post("/v1/jobs", json=self.request_body(), headers=AUTH)
        self.assertEqual(response.status_code, 202)
        self.assertRegex(response.json()["job_id"], r"^[A-Za-z0-9_-]{16,128}$")

    def test_status_is_owner_scoped_and_does_not_expose_payload(self):
        created = client.post("/v1/jobs", json=self.request_body(), headers=AUTH)
        job_id = created.json()["job_id"]

        status = client.get(
            f"/v1/jobs/{job_id}",
            headers={**AUTH, "X-User-Ref": "test-user-1"},
        )
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.json()["status"], "queued")
        self.assertEqual(status.json()["task"], "tax_question")
        self.assertNotIn("input", status.json())
        self.assertNotIn("payload_json", status.json())

        other_user = client.get(
            f"/v1/jobs/{job_id}",
            headers={**AUTH, "X-User-Ref": "someone-else"},
        )
        self.assertEqual(other_user.status_code, 404)

    def test_status_requires_authentication(self):
        created = client.post("/v1/jobs", json=self.request_body(), headers=AUTH)
        job_id = created.json()["job_id"]
        response = client.get(
            f"/v1/jobs/{job_id}",
            headers={"X-User-Ref": "test-user-1"},
        )
        self.assertEqual(response.status_code, 401)

    def test_idempotency_returns_same_job_for_same_request_id(self):
        body = self.request_body()
        first = client.post("/v1/jobs", json=body, headers=AUTH)
        second = client.post("/v1/jobs", json=body, headers=AUTH)
        self.assertEqual(first.json()["job_id"], second.json()["job_id"])

    def test_idempotency_uses_canonical_json_object_key_order(self):
        request_id = "e" * 32
        first_body = self.request_body(
            task="tax_data_analysis",
            data={"data": [{"b": 2, "a": 1}]},
            request_id=request_id,
        )
        first = client.post("/v1/jobs", json=first_body, headers=AUTH)
        self.assertEqual(first.status_code, 202)

        reordered_body = self.request_body(
            task="tax_data_analysis",
            data={"data": [{"a": 1, "b": 2}]},
            request_id=request_id,
        )
        second = client.post("/v1/jobs", json=reordered_body, headers=AUTH)
        self.assertEqual(second.status_code, 202)
        self.assertEqual(first.json()["job_id"], second.json()["job_id"])

    def test_reused_request_id_with_different_payload_is_rejected(self):
        body = self.request_body()
        first = client.post("/v1/jobs", json=body, headers=AUTH)
        self.assertEqual(first.status_code, 202)

        conflicting = self.request_body(data={"question": "otra consulta"})
        response = client.post("/v1/jobs", json=conflicting, headers=AUTH)
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], "request id conflict")

    def test_reused_request_id_across_users_is_rejected(self):
        body = self.request_body()
        self.assertEqual(client.post("/v1/jobs", json=body, headers=AUTH).status_code, 202)
        conflicting = dict(body)
        conflicting["user_ref"] = "different-user"
        self.assertEqual(client.post("/v1/jobs", json=conflicting, headers=AUTH).status_code, 409)

    def test_duplicate_json_keys_are_rejected(self):
        raw = (
            '{"task":"tax_question","input":{"question":"one"},'
            '"request_id":"' + ("c" * 32) + '","user_ref":"test-user-1",'
            '"user_ref":"other-user"}'
        )
        response = client.post("/v1/jobs", content=raw, headers={**AUTH, "Content-Type": "application/json"})
        self.assertEqual(response.status_code, 400)

    def test_lone_unicode_surrogates_are_rejected(self):
        invalid_bodies = [
            self.request_body(data={"question": "\ud800"}),
            self.request_body(
                task="document_summary",
                data={"text": "\udfff"},
                request_id="8" * 32,
            ),
            self.request_body(request_id="7" * 32),
        ]
        invalid_bodies[2]["user_ref"] = "\ud800"

        for body in invalid_bodies:
            with self.subTest(body=body):
                raw = json.dumps(body, ensure_ascii=True).encode("utf-8")
                response = client.post(
                    "/v1/jobs",
                    content=raw,
                    headers={**AUTH, "Content-Type": "application/json"},
                )
                self.assertEqual(response.status_code, 400)

    def test_non_finite_json_numbers_are_rejected(self):
        for number in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(number=number):
                raw = (
                    '{"task":"tax_data_analysis","input":{"data":[{"amount":'
                    + number
                    + '}]},"request_id":"'
                    + ("9" * 32)
                    + '","user_ref":"test-user-1"}'
                )
                response = client.post(
                    "/v1/jobs",
                    content=raw,
                    headers={**AUTH, "Content-Type": "application/json"},
                )
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], "invalid JSON")

    def test_oversized_raw_request_is_rejected(self):
        raw = b'{"padding":"' + (b"x" * 100_000) + b'"}'
        response = client.post("/v1/jobs", content=raw, headers={**AUTH, "Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)

    def test_excessively_nested_json_is_rejected_without_server_error(self):
        nested = "[" * 1200 + "0" + "]" * 1200
        raw = ('{"task":' + nested + ',"input":{},"request_id":"' + ("d" * 32) + '","user_ref":"test-user-1"}').encode()
        response = client.post(
            "/v1/jobs",
            content=raw,
            headers={**AUTH, "Content-Type": "application/json"},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["detail"], "invalid task")

    def test_unknown_fields_are_rejected(self):
        body = self.request_body()
        body["shell_command"] = "whoami"
        self.assertEqual(client.post("/v1/jobs", json=body, headers=AUTH).status_code, 400)

    def test_task_input_schema_is_strict(self):
        body = self.request_body(data={"question": "hola", "path": "/etc/passwd"})
        self.assertEqual(client.post("/v1/jobs", json=body, headers=AUTH).status_code, 400)

    def test_non_string_task_types_are_rejected_without_server_error(self):
        for invalid_task in ([], {}, {"nested": "task"}):
            with self.subTest(task=invalid_task):
                body = self.request_body()
                body["task"] = invalid_task
                response = client.post("/v1/jobs", json=body, headers=AUTH)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json()["detail"], "invalid task")

    def test_invalid_task_is_rejected(self):
        body = self.request_body(task="shell", data={"command": "whoami"})
        self.assertEqual(client.post("/v1/jobs", json=body, headers=AUTH).status_code, 400)

    def test_document_summary_and_analysis_schemas(self):
        summary = self.request_body("document_summary", {"text": "Documento ficticio"})
        analysis = self.request_body("tax_data_analysis", {"data": [{"amount": 100}]}, "b" * 32)
        self.assertEqual(client.post("/v1/jobs", json=summary, headers=AUTH).status_code, 202)
        self.assertEqual(client.post("/v1/jobs", json=analysis, headers=AUTH).status_code, 202)

    def test_oversized_input_is_rejected(self):
        body = self.request_body(data={"question": "x" * 9000})
        self.assertEqual(client.post("/v1/jobs", json=body, headers=AUTH).status_code, 400)


    def test_claim_and_complete_job_lifecycle(self):
        import openharness_ingress
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        claimed = openharness_ingress.claim_next_job(now=int(__import__('time').time()) + 10)
        self.assertEqual(claimed["job_id"], job_id)
        self.assertEqual(claimed["attempt"], 1)
        self.assertIsNone(openharness_ingress.claim_next_job(now=1001))
        self.assertEqual(openharness_ingress.finish_job(
            job_id, claimed["lease_token"], result={"summary": "synthetic-ok"}, now=int(__import__('time').time()) + 12
        ), "completed")
        status = client.get(f"/v1/jobs/{job_id}", headers={**AUTH, "X-User-Ref": "test-user-1"})
        self.assertEqual(status.json()["status"], "completed")


    def test_internal_worker_http_claim_and_complete_requires_service_auth(self):
        import openharness_ingress
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        denied = client.post("/internal/worker/claim")
        self.assertEqual(denied.status_code, 401)
        claimed_response = client.post("/internal/worker/claim", headers=AUTH)
        self.assertEqual(claimed_response.status_code, 200)
        claimed = claimed_response.json()["job"]
        self.assertEqual(claimed["job_id"], job_id)
        completed = client.post(
            f"/internal/worker/{job_id}/complete",
            json={"lease_token": claimed["lease_token"], "result": {"synthetic": True}},
            headers=AUTH,
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.json()["status"], "completed")
        status = client.get(
            f"/v1/jobs/{job_id}",
            headers={**AUTH, "X-User-Ref": "test-user-1"},
        )
        self.assertEqual(status.json()["attempts"], 1)
        self.assertIsNone(status.json()["error_code"])
        self.assertNotIn("result", status.json())

    def test_failure_requeues_and_expired_lease_recovers(self):
        import openharness_ingress
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        first = openharness_ingress.claim_next_job(now=int(__import__('time').time()) + 10)
        self.assertEqual(openharness_ingress.finish_job(
            job_id, first["lease_token"], error_code="synthetic_failure", now=int(__import__('time').time()) + 11
        ), "queued")
        self.assertIsNone(openharness_ingress.claim_next_job(now=int(__import__('time').time()) + 12))
        second = openharness_ingress.claim_next_job(now=int(__import__('time').time()) + 30)
        self.assertEqual(second["attempt"], 2)
        recovered = openharness_ingress.claim_next_job(now=int(__import__('time').time()) + 30 + openharness_ingress.LEASE_SECONDS + 1)
        self.assertEqual(recovered["job_id"], job_id)
        with self.assertRaises(Exception) as stale:
            openharness_ingress.finish_job(job_id, second["lease_token"], result={"bad": True},
                                           now=int(__import__('time').time()) + 30 + openharness_ingress.LEASE_SECONDS + 2)
        self.assertEqual(getattr(stale.exception, "status_code", None), 409)

    def test_expired_job_fails_after_attempt_limit(self):
        import openharness_ingress
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        for attempt in range(3):
            claimed = openharness_ingress.claim_next_job(now=int(__import__('time').time()) + 10 + attempt * 1000)
            self.assertEqual(claimed["job_id"], job_id)
            if attempt < 2:
                openharness_ingress.finish_job(job_id, claimed["lease_token"],
                    error_code="synthetic_failure", now=int(__import__('time').time()) + 11 + attempt * 1000)
                connection = openharness_ingress.db()
                connection.execute("UPDATE jobs SET available_at=0 WHERE job_id=?", (job_id,))
                connection.commit()
                connection.close()
        self.assertIsNone(openharness_ingress.claim_next_job(
            now=int(__import__('time').time()) + 2010 + openharness_ingress.LEASE_SECONDS + 1))
        status = client.get(f"/v1/jobs/{job_id}", headers={**AUTH, "X-User-Ref": "test-user-1"})
        self.assertEqual(status.json()["status"], "failed")

    def test_invalid_and_oversized_results_are_rejected(self):
        import openharness_ingress
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        claimed = openharness_ingress.claim_next_job(now=int(__import__('time').time()) + 10)
        with self.assertRaises(Exception) as oversized:
            openharness_ingress.finish_job(job_id, claimed["lease_token"],
                result={"text": "x" * 60000}, now=int(__import__('time').time()) + 11)
        self.assertEqual(getattr(oversized.exception, "status_code", None), 400)


    def test_concurrent_claims_never_return_the_same_job(self):
        import openharness_ingress
        first = client.post("/v1/jobs", json=self.request_body(request_id="1" * 32), headers=AUTH)
        second = client.post("/v1/jobs", json=self.request_body(request_id="2" * 32), headers=AUTH)
        self.assertEqual(first.status_code, 202)
        self.assertEqual(second.status_code, 202)
        with ThreadPoolExecutor(max_workers=2) as pool:
            claimed = list(pool.map(lambda _: openharness_ingress.claim_next_job(), range(2)))
        claimed_ids = [job["job_id"] for job in claimed if job is not None]
        self.assertEqual(len(claimed_ids), 2)
        self.assertEqual(len(set(claimed_ids)), 2)

    def test_legacy_queue_schema_is_migrated_without_losing_queued_jobs(self):
        import openharness_ingress
        db_path = Path(_tmp.name) / "jobs.sqlite3"
        with sqlite3.connect(db_path) as connection:
            connection.execute("""CREATE TABLE jobs (
                job_id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE,
                user_ref TEXT NOT NULL, task TEXT NOT NULL, payload_json TEXT NOT NULL,
                status TEXT NOT NULL, created_at INTEGER NOT NULL
            )""")
            connection.execute(
                "INSERT INTO jobs VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("legacy-job-0000001", "3" * 32, "legacy-owner", "tax_question",
                 '{"question":"synthetic legacy"}', "queued", 123),
            )
        connection = openharness_ingress.db()
        try:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
            self.assertTrue({"updated_at", "available_at", "attempts", "max_attempts",
                             "lease_token_hash", "lease_until", "error_code", "result_json"}.issubset(columns))
            row = connection.execute(
                "SELECT status, created_at, updated_at, available_at, attempts, max_attempts "
                "FROM jobs WHERE job_id=?", ("legacy-job-0000001",)
            ).fetchone()
            self.assertEqual(row, ("queued", 123, 123, 123, 0, 3))
        finally:
            connection.close()

    def test_internal_worker_fail_endpoint_retries_with_authenticated_service_token(self):
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        denied = client.post(
            f"/internal/worker/{job_id}/fail",
            json={"lease_token": "x" * 40, "error_code": "synthetic_failure"},
        )
        self.assertEqual(denied.status_code, 401)
        claimed = client.post("/internal/worker/claim", headers=AUTH).json()["job"]
        failed = client.post(
            f"/internal/worker/{job_id}/fail",
            json={"lease_token": claimed["lease_token"], "error_code": "synthetic_failure"},
            headers=AUTH,
        )
        self.assertEqual(failed.status_code, 200)
        self.assertEqual(failed.json()["status"], "queued")

    def test_queue_capacity_is_enforced(self):
        import openharness_ingress

        connection = openharness_ingress.db()
        try:
            for index in range(100):
                connection.execute(
                    "INSERT INTO jobs (job_id, request_id, user_ref, task, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)",
                    (
                        f"seed-job-{index:04d}",
                        f"{index:032x}",
                        "seed-user",
                        "tax_question",
                        '{"question":"synthetic"}',
                        1,
                    ),
                )
            connection.commit()
        finally:
            connection.close()

        body = self.request_body(request_id="f" * 32)
        response = client.post("/v1/jobs", json=body, headers=AUTH)
        self.assertEqual(response.status_code, 429)
        self.assertEqual(response.json()["detail"], "queue full")


if __name__ == "__main__":
    unittest.main()
