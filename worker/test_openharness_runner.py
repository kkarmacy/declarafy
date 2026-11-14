import asyncio
import os
import unittest
from unittest.mock import patch

import httpx

from openharness_runner import _enabled, _internal_base_url, process_one


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def json(self):
        return self.payload

    def raise_for_status(self):
        return None


class FakeClient:
    def __init__(self, job):
        self.job = job
        self.calls = []

    def post(self, path, **kwargs):
        self.calls.append((path, kwargs))
        if path == "/internal/worker/claim":
            return FakeResponse({"job": self.job})
        return FakeResponse({"status": "completed"})


class RunnerGateTests(unittest.TestCase):
    def test_internal_url_accepts_only_exact_compose_service(self):
        self.assertEqual(_internal_base_url("http://openharness-worker:8080"), "http://openharness-worker:8080")
        self.assertEqual(_internal_base_url("http://openharness-worker:8080/"), "http://openharness-worker:8080")

    def test_internal_url_rejects_lookalike_or_external_destinations(self):
        for value in (
            "http://openharness-worker.evil:8080",
            "http://openharness-worker:8080.evil",
            "https://attacker.example",
            "http://user@openharness-worker:8080",
            "http://openharness-worker:8080/path",
            "http://openharness-worker:8080/?next=https://attacker.example",
            "http://127.0.0.1:8080",
        ):
            with self.subTest(value=value), self.assertRaises(RuntimeError):
                _internal_base_url(value)

    def test_runner_is_disabled_by_default(self):
        with patch.dict(os.environ, {}, clear=True):
            self.assertFalse(_enabled())

    def test_runner_requires_both_independent_flags(self):
        with patch.dict(os.environ, {"OPENHARNESS_RUNNER_ENABLED": "1"}, clear=True):
            self.assertFalse(_enabled())
        with patch.dict(os.environ, {"OPENHARNESS_EXECUTION_ENABLED": "1"}, clear=True):
            self.assertFalse(_enabled())

    def test_runner_requires_both_flags_explicitly_enabled(self):
        with patch.dict(os.environ, {
            "OPENHARNESS_RUNNER_ENABLED": "1",
            "OPENHARNESS_EXECUTION_ENABLED": "1",
        }, clear=True):
            self.assertTrue(_enabled())

    def test_empty_queue_does_not_execute(self):
        client = FakeClient(None)
        with patch("openharness_runner.asyncio.run") as run:
            self.assertFalse(process_one(client, "s" * 40))
        run.assert_not_called()
        self.assertEqual(len(client.calls), 1)

    def test_successful_job_posts_result_with_lease_token(self):
        job = {
            "job_id": "a" * 24,
            "lease_token": "l" * 40,
            "task": "tax_question",
            "input": {"question": "synthetic"},
        }
        client = FakeClient(job)
        expected = {"text": "synthetic result", "tools_used": []}
        with patch("openharness_runner.asyncio.run", return_value=expected):
            self.assertTrue(process_one(client, "s" * 40))
        self.assertEqual(client.calls[1][0], f"/internal/worker/{job['job_id']}/complete")
        self.assertEqual(client.calls[1][1]["json"], {
            "lease_token": job["lease_token"], "result": expected
        })

    def test_runtime_failure_posts_only_sanitized_error_code(self):
        job = {
            "job_id": "b" * 24,
            "lease_token": "l" * 40,
            "task": "tax_question",
            "input": {"question": "private taxpayer text"},
        }
        client = FakeClient(job)
        with patch("openharness_runner.asyncio.run", side_effect=RuntimeError("secret response")):
            self.assertTrue(process_one(client, "s" * 40))
        path, kwargs = client.calls[1]
        self.assertEqual(path, f"/internal/worker/{job['job_id']}/fail")
        self.assertEqual(kwargs["json"], {
            "lease_token": job["lease_token"], "error_code": "execution_failed"
        })
        self.assertNotIn("private taxpayer text", str(client.calls))
        self.assertNotIn("secret response", str(client.calls))
