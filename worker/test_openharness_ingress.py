import json
import os
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
import sqlite3
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient

_tmp = tempfile.TemporaryDirectory()
os.environ["WORKER_DATA_DIR"] = _tmp.name
os.environ["DECLARAFY_WORKER_TOKEN"] = "test-token-" + ("x" * 40)
os.environ["DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON"] = json.dumps({"test-key": __import__("base64").b64encode(b"t" * 32).decode()})
os.environ["DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID"] = "test-key"

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


    def test_live_worker_can_renew_lease_but_stale_worker_cannot(self):
        import openharness_ingress
        now = int(__import__('time').time()) + 100
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        claimed = openharness_ingress.claim_next_job(now=now)
        renewed_until = openharness_ingress.renew_job_lease(job_id, claimed["lease_token"], now=now + 30)
        self.assertEqual(renewed_until, now + 30 + openharness_ingress.LEASE_SECONDS)
        with self.assertRaises(Exception) as expired:
            openharness_ingress.renew_job_lease(job_id, claimed["lease_token"], now=renewed_until)
        self.assertEqual(getattr(expired.exception, "status_code", None), 409)

    def test_status_never_exposes_payload_or_completed_result(self):
        import openharness_ingress

        body = self.request_body(request_id="9" * 32)
        job_id = client.post("/v1/jobs", json=body, headers=AUTH).json()["job_id"]
        claimed = openharness_ingress.claim_next_job()
        self.assertEqual(claimed["job_id"], job_id)
        openharness_ingress.finish_job(
            job_id, claimed["lease_token"], result={"synthetic_result": "private"}
        )

        response = client.get(
            f"/v1/jobs/{job_id}",
            headers={**AUTH, "X-User-Ref": "test-user-1"},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "completed")
        self.assertNotIn("result", response.json())
        self.assertNotIn("result_json", response.json())
        self.assertNotIn("input", response.json())
        self.assertNotIn("payload_json", response.json())
        foreign = client.get(
            f"/v1/jobs/{job_id}",
            headers={**AUTH, "X-User-Ref": "another-user"},
        )
        self.assertEqual(foreign.status_code, 404)

    def test_owner_can_cancel_queued_and_running_jobs_and_worker_is_fenced(self):
        import openharness_ingress
        queued_id = client.post("/v1/jobs", json=self.request_body(request_id="3" * 32), headers=AUTH).json()["job_id"]
        self.assertEqual(openharness_ingress.cancel_job(queued_id, "test-user-1"), "cancelled")
        self.assertIsNone(openharness_ingress.claim_next_job())
        running_id = client.post("/v1/jobs", json=self.request_body(request_id="4" * 32), headers=AUTH).json()["job_id"]
        claimed = openharness_ingress.claim_next_job()
        self.assertEqual(claimed["job_id"], running_id)
        self.assertEqual(openharness_ingress.cancel_job(running_id, "test-user-1"), "cancelled")
        with self.assertRaises(Exception) as stale:
            openharness_ingress.finish_job(running_id, claimed["lease_token"], result={"should_not_save": True})
        self.assertEqual(getattr(stale.exception, "status_code", None), 409)
        with self.assertRaises(Exception) as stale_renew:
            openharness_ingress.renew_job_lease(running_id, claimed["lease_token"])
        self.assertEqual(getattr(stale_renew.exception, "status_code", None), 409)
        status = client.get(f"/v1/jobs/{running_id}", headers={**AUTH, "X-User-Ref": "test-user-1"})
        self.assertEqual(status.json()["status"], "cancelled")

    def test_cancellation_is_owner_scoped_and_terminal_jobs_are_not_cancellable(self):
        import openharness_ingress
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        with self.assertRaises(Exception) as wrong_owner:
            openharness_ingress.cancel_job(job_id, "other-user")
        self.assertEqual(getattr(wrong_owner.exception, "status_code", None), 404)
        claimed = openharness_ingress.claim_next_job()
        openharness_ingress.finish_job(job_id, claimed["lease_token"], result={"synthetic": True})
        with self.assertRaises(Exception) as terminal:
            openharness_ingress.cancel_job(job_id, "test-user-1")
        self.assertEqual(getattr(terminal.exception, "status_code", None), 409)

    def test_internal_renew_and_cancel_endpoints_require_service_auth(self):
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        self.assertEqual(client.post(f"/internal/jobs/{job_id}/cancel", json={"user_ref": "test-user-1"}).status_code, 401)
        response = client.post(f"/internal/jobs/{job_id}/cancel", json={"user_ref": "test-user-1"}, headers=AUTH)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "cancelled")

    def test_retention_prunes_only_old_terminal_jobs(self):
        import openharness_ingress

        now = 2_000_000_000
        cutoff = now - openharness_ingress.RETENTION_SECONDS
        connection = openharness_ingress.db()
        try:
            rows = [
                ("old-completed-0001", "a" * 32, "owner", "tax_question", "{}", "completed", cutoff - 1, cutoff - 1),
                ("old-failed-000001", "b" * 32, "owner", "tax_question", "{}", "failed", cutoff - 1, cutoff - 1),
                ("old-cancelled-0001", "f" * 32, "owner", "tax_question", "{}", "cancelled", cutoff - 1, cutoff - 1),
                ("recent-completed1", "c" * 32, "owner", "tax_question", "{}", "completed", now, now),
                ("old-queued-000001", "d" * 32, "owner", "tax_question", "{}", "queued", cutoff - 1, cutoff - 1),
                ("old-running-00001", "e" * 32, "owner", "tax_question", "{}", "running", cutoff - 1, cutoff - 1),
            ]
            connection.executemany(
                "INSERT INTO jobs (job_id, request_id, user_ref, task, payload_json, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                rows,
            )
            connection.commit()
        finally:
            connection.close()

        self.assertEqual(openharness_ingress.prune_terminal_jobs(now=now), 3)
        connection = openharness_ingress.db()
        try:
            remaining = {row[0]: row[1] for row in connection.execute("SELECT job_id, status FROM jobs")}
        finally:
            connection.close()
        self.assertEqual(remaining, {
            "recent-completed1": "completed",
            "old-queued-000001": "queued",
            "old-running-00001": "running",
        })


    def test_input_and_result_are_encrypted_at_rest_and_worker_receives_plaintext(self):
        import openharness_ingress
        from encryption import decrypt_field
        job_id = client.post("/v1/jobs", json=self.request_body(), headers=AUTH).json()["job_id"]
        connection = openharness_ingress.db()
        try:
            stored_payload = connection.execute(
                "SELECT payload_json FROM jobs WHERE job_id=?", (job_id,)
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertTrue(stored_payload.startswith("enc:v1:"))
        self.assertNotIn("¿Cuál es la tasa", stored_payload)
        claimed = openharness_ingress.claim_next_job()
        self.assertEqual(claimed["input"], {"question": "¿Cuál es la tasa aplicable?"})
        openharness_ingress.finish_job(job_id, claimed["lease_token"], result={"answer": "synthetic-only"})
        connection = openharness_ingress.db()
        try:
            stored_result = connection.execute(
                "SELECT result_json FROM jobs WHERE job_id=?", (job_id,)
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertTrue(stored_result.startswith("enc:v1:"))
        self.assertEqual(decrypt_field(job_id, "result_json", stored_result), '{"answer":"synthetic-only"}')

    def test_legacy_plaintext_claim_fails_closed_without_consuming_job(self):
        import openharness_ingress
        connection = openharness_ingress.db()
        connection.execute(
            "INSERT INTO jobs (job_id, request_id, user_ref, task, payload_json, status, created_at, available_at) VALUES (?, ?, ?, ?, ?, 'queued', ?, ?)",
            ("legacy-queue-job-0001", "f" * 32, "legacy-owner", "tax_question", '{"question":"legacy"}', 1, 1),
        )
        connection.commit()
        connection.close()
        with self.assertRaises(Exception) as failure:
            openharness_ingress.claim_next_job(now=10)
        self.assertEqual(getattr(failure.exception, "status_code", None), 503)
        connection = openharness_ingress.db()
        try:
            status = connection.execute(
                "SELECT status FROM jobs WHERE job_id=?", ("legacy-queue-job-0001",)
            ).fetchone()[0]
        finally:
            connection.close()
        self.assertEqual(status, "queued")

    def test_worker_refuses_new_jobs_without_encryption_key(self):
        with patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": "",
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "",
        }):
            response = client.post("/v1/jobs", json=self.request_body(), headers=AUTH)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json()["detail"], "queue encryption unavailable")


    def test_health_and_empty_worker_claim_fail_when_encryption_key_is_missing(self):
        with patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": "",
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "",
        }):
            health = client.get("/health")
            self.assertEqual(health.status_code, 503)
            claim = client.post("/internal/worker/claim", headers=AUTH)
            self.assertEqual(claim.status_code, 503)
            self.assertEqual(claim.json()["detail"], "worker encryption not configured")


    def test_service_token_can_be_loaded_from_mounted_secret_file(self):
        import openharness_ingress
        with tempfile.TemporaryDirectory() as directory:
            secret = Path(directory) / "worker-token"
            secret.write_text(os.environ["DECLARAFY_WORKER_TOKEN"], encoding="utf-8")
            with patch.dict(os.environ, {"DECLARAFY_WORKER_TOKEN_FILE": str(secret)}):
                self.assertEqual(openharness_ingress.token(), os.environ["DECLARAFY_WORKER_TOKEN"])


if __name__ == "__main__":
    unittest.main()
