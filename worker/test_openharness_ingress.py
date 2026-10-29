import json
import os
import tempfile
import unittest
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

    def test_authentication_is_required(self):
        response = client.post("/v1/jobs", json=self.request_body())
        self.assertEqual(response.status_code, 401)

    def test_valid_task_is_durably_queued_but_not_executed(self):
        response = client.post("/v1/jobs", json=self.request_body(), headers=AUTH)
        self.assertEqual(response.status_code, 202)
        self.assertRegex(response.json()["job_id"], r"^[A-Za-z0-9_-]{16,128}$")

    def test_idempotency_returns_same_job_for_same_request_id(self):
        body = self.request_body()
        first = client.post("/v1/jobs", json=body, headers=AUTH)
        second = client.post("/v1/jobs", json=body, headers=AUTH)
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

    def test_oversized_raw_request_is_rejected(self):
        raw = b'{"padding":"' + (b"x" * 100_000) + b'"}'
        response = client.post("/v1/jobs", content=raw, headers={**AUTH, "Content-Type": "application/json"})
        self.assertEqual(response.status_code, 413)

    def test_unknown_fields_are_rejected(self):
        body = self.request_body()
        body["shell_command"] = "whoami"
        self.assertEqual(client.post("/v1/jobs", json=body, headers=AUTH).status_code, 400)

    def test_task_input_schema_is_strict(self):
        body = self.request_body(data={"question": "hola", "path": "/etc/passwd"})
        self.assertEqual(client.post("/v1/jobs", json=body, headers=AUTH).status_code, 400)

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


if __name__ == "__main__":
    unittest.main()
