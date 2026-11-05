"""Opt-in single-job OpenHarness consumer.

This process is separate from the HTTP ingress. It remains inert unless both
OPENHARNESS_RUNNER_ENABLED and OPENHARNESS_EXECUTION_ENABLED are exactly "1".
It claims at most one job per iteration; the runtime is bounded below the
120-second lease and has no registered tools.
"""
from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx

from openharness_runtime import (
    RuntimeConfigurationError,
    RuntimeDisabled,
    RuntimeExecutionError,
    run_openharness_task,
)

DEFAULT_API = "http://openharness-worker:8080"
POLL_SECONDS = 3
HTTP_TIMEOUT = 5.0


def _enabled() -> bool:
    return (
        os.environ.get("OPENHARNESS_RUNNER_ENABLED", "0") == "1"
        and os.environ.get("OPENHARNESS_EXECUTION_ENABLED", "0") == "1"
    )


def _service_token() -> str:
    path = os.environ.get("DECLARAFY_WORKER_TOKEN_FILE", "")
    if not path:
        raise RuntimeError("worker service token is not configured")
    from pathlib import Path
    import stat

    token_path = Path(path)
    try:
        info = token_path.lstat()
        value = token_path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        raise RuntimeError("worker service token is unavailable") from None
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or len(value) < 32:
        raise RuntimeError("worker service token permissions or value are invalid")
    return value


def process_one(client: httpx.Client, service_token: str) -> bool:
    """Claim and process at most one task. Returns False when queue is empty."""
    headers = {"Authorization": f"Bearer {service_token}"}
    response = client.post("/internal/worker/claim", headers=headers)
    response.raise_for_status()
    job = response.json().get("job")
    if job is None:
        return False

    job_id = job["job_id"]
    lease_token = job["lease_token"]
    try:
        result = asyncio.run(run_openharness_task(job["task"], job["input"]))
        completed = client.post(
            f"/internal/worker/{job_id}/complete",
            headers=headers,
            json={"lease_token": lease_token, "result": result},
        )
        completed.raise_for_status()
    except (RuntimeDisabled, RuntimeConfigurationError):
        # Configuration errors are not transient model failures; fail the job
        # without retrying by allowing the queue's bounded attempt policy to
        # decide the terminal state.
        failed = client.post(
            f"/internal/worker/{job_id}/fail",
            headers=headers,
            json={"lease_token": lease_token, "error_code": "runtime_unavailable"},
        )
        failed.raise_for_status()
    except Exception:
        # Never log prompts, provider responses, credentials, or raw exceptions.
        failed = client.post(
            f"/internal/worker/{job_id}/fail",
            headers=headers,
            json={"lease_token": lease_token, "error_code": "execution_failed"},
        )
        failed.raise_for_status()
    return True


def main() -> int:
    if not _enabled():
        print("OpenHarness runner is disabled; no jobs were claimed.")
        return 0
    service_token = _service_token()
    base_url = os.environ.get("OPENHARNESS_WORKER_INTERNAL_URL", DEFAULT_API).rstrip("/")
    if not base_url.startswith("http://openharness-worker:") and not base_url.startswith("https://"):
        raise RuntimeError("worker internal URL must use the private service host or HTTPS")
    with httpx.Client(base_url=base_url, timeout=HTTP_TIMEOUT) as client:
        while _enabled():
            try:
                processed = process_one(client, service_token)
            except httpx.HTTPError:
                # Avoid busy-looping during temporary ingress/network failures.
                time.sleep(POLL_SECONDS)
                continue
            if not processed:
                time.sleep(POLL_SECONDS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
