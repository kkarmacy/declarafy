"""Minimal authenticated OpenHarness job-ingress service.

This service validates and durably queues bounded task envelopes. It deliberately
DOES NOT execute OpenHarness yet; execution remains disabled pending sandbox and
cost-control implementation. Do not expose publicly until deployed behind TLS.
"""
from __future__ import annotations

import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

APP_DIR = Path(os.environ.get("WORKER_DATA_DIR", "/var/lib/declarafy-worker"))
DB_PATH = APP_DIR / "jobs.sqlite3"
MAX_BODY = 100_000
MAX_INPUT = 50_000
TASKS = {"tax_question", "document_summary", "tax_data_analysis"}
JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{16,128}$")
REQUEST_ID_RE = re.compile(r"^[0-9a-f]{32}$")
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


def token() -> str:
    return os.environ.get("DECLARAFY_WORKER_TOKEN", "")


def restrict_storage_permissions() -> None:
    # SQLite creates WAL/SHM sidecars lazily. Restrict them whenever present,
    # not only the main database file.
    for path in (DB_PATH, Path(str(DB_PATH) + "-wal"), Path(str(DB_PATH) + "-shm")):
        if path.exists():
            os.chmod(path, 0o600)


def db() -> sqlite3.Connection:
    APP_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    # A pre-existing mounted volume may have permissive directory mode. Enforce
    # private permissions before opening the database, then restrict the DB file.
    os.chmod(APP_DIR, 0o700)
    connection = sqlite3.connect(DB_PATH, timeout=5)
    os.chmod(DB_PATH, 0o600)
    connection.execute("PRAGMA journal_mode=WAL")
    restrict_storage_permissions()
    connection.execute("""CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        user_ref TEXT NOT NULL,
        task TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        available_at INTEGER NOT NULL DEFAULT 0,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        lease_token_hash TEXT,
        lease_until INTEGER,
        error_code TEXT,
        result_json TEXT
    )""")
    # Forward-only migration for databases created by earlier prototype versions.
    columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
    migrations = {
        "updated_at": "INTEGER NOT NULL DEFAULT 0",
        "available_at": "INTEGER NOT NULL DEFAULT 0",
        "attempts": "INTEGER NOT NULL DEFAULT 0",
        "max_attempts": "INTEGER NOT NULL DEFAULT 3",
        "lease_token_hash": "TEXT",
        "lease_until": "INTEGER",
        "error_code": "TEXT",
        "result_json": "TEXT",
    }
    for name, definition in migrations.items():
        if name not in columns:
            connection.execute(f"ALTER TABLE jobs ADD COLUMN {name} {definition}")
    connection.execute("UPDATE jobs SET updated_at=created_at WHERE updated_at=0")
    connection.execute("UPDATE jobs SET available_at=created_at WHERE available_at=0")
    connection.execute("CREATE INDEX IF NOT EXISTS jobs_queue_idx ON jobs(status, available_at, created_at)")
    connection.execute("CREATE INDEX IF NOT EXISTS jobs_lease_idx ON jobs(status, lease_until)")
    connection.commit()
    return connection


LEASE_SECONDS = 120
MAX_RESULT_BYTES = 50_000


def _service_authorized(authorization: str | None) -> bool:
    expected = token()
    supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    return len(expected) >= 32 and bool(supplied) and hmac.compare_digest(supplied, expected)


def claim_next_job(now: int | None = None) -> dict[str, Any] | None:
    """Atomically recover expired leases and claim one eligible job."""
    now = int(time.time()) if now is None else int(now)
    connection = db()
    try:
        connection.execute("BEGIN IMMEDIATE")
        # Expired leases are retried, or moved to terminal failure at the attempt cap.
        connection.execute(
            """UPDATE jobs SET
                 status=CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'queued' END,
                 error_code=CASE WHEN attempts >= max_attempts THEN 'lease_expired' ELSE error_code END,
                 lease_token_hash=NULL, lease_until=NULL, updated_at=?
               WHERE status='running' AND lease_until IS NOT NULL AND lease_until <= ?""",
            (now, now),
        )
        row = connection.execute(
            """SELECT job_id, user_ref, task, payload_json, attempts, max_attempts
               FROM jobs WHERE status='queued' AND available_at <= ?
               ORDER BY created_at, job_id LIMIT 1""",
            (now,),
        ).fetchone()
        if row is None:
            connection.commit()
            return None
        job_id, user_ref, task, payload_json, attempts, max_attempts = row
        lease_token = secrets.token_urlsafe(32)
        connection.execute(
            """UPDATE jobs SET status='running', attempts=attempts+1,
               lease_token_hash=?, lease_until=?, updated_at=?, error_code=NULL
               WHERE job_id=? AND status='queued'""",
            (hmac.new(token().encode(), lease_token.encode(), "sha256").hexdigest(),
             now + LEASE_SECONDS, now, job_id),
        )
        connection.commit()
        restrict_storage_permissions()
        return {"job_id": job_id, "user_ref": user_ref, "task": task,
                "input": json.loads(payload_json), "attempt": attempts + 1,
                "max_attempts": max_attempts, "lease_token": lease_token,
                "lease_until": now + LEASE_SECONDS}
    finally:
        connection.close()


def finish_job(job_id: str, lease_token: str, *, result: Any = None,
               error_code: str | None = None, now: int | None = None) -> str:
    """Complete/fail only the currently leased attempt; stale workers cannot overwrite."""
    now = int(time.time()) if now is None else int(now)
    if not JOB_ID_RE.fullmatch(job_id) or not isinstance(lease_token, str) or len(lease_token) < 32:
        raise HTTPException(400, "invalid lease")
    if (result is None) == (error_code is None):
        raise HTTPException(400, "provide exactly one of result or error_code")
    result_json = None
    if result is not None:
        try:
            result_json = json.dumps(result, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
            if len(result_json.encode("utf-8")) > MAX_RESULT_BYTES:
                raise ValueError("result too large")
        except (TypeError, ValueError, UnicodeEncodeError, RecursionError):
            raise HTTPException(400, "invalid result") from None
    if error_code is not None and (not isinstance(error_code, str) or not re.fullmatch(r"[a-z0-9_]{1,64}", error_code)):
        raise HTTPException(400, "invalid error code")
    lease_hash = hmac.new(token().encode(), lease_token.encode(), "sha256").hexdigest()
    connection = db()
    try:
        connection.execute("BEGIN IMMEDIATE")
        row = connection.execute(
            "SELECT attempts, max_attempts, lease_until FROM jobs WHERE job_id=? AND status='running' AND lease_token_hash=?",
            (job_id, lease_hash),
        ).fetchone()
        if row is None or row[2] is None or row[2] <= now:
            connection.rollback()
            raise HTTPException(409, "lease expired or superseded")
        attempts, max_attempts, _ = row
        if result_json is not None:
            status, next_error, available_at = "completed", None, now
        elif attempts < max_attempts:
            status, next_error, available_at = "queued", error_code, now + min(300, 2 ** attempts * 5)
        else:
            status, next_error, available_at = "failed", error_code, now
        connection.execute(
            """UPDATE jobs SET status=?, result_json=?, error_code=?, available_at=?,
               lease_token_hash=NULL, lease_until=NULL, updated_at=? WHERE job_id=?""",
            (status, result_json, next_error, available_at, now, job_id),
        )
        connection.commit()
        restrict_storage_permissions()
        return status
    finally:
        connection.close()


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def reject_nonfinite_constant(value: str) -> None:
    # Python's json module accepts NaN/Infinity by default although they are not
    # valid JSON numbers. Reject them before they can be persisted as task data.
    raise ValueError("non-finite JSON number")


def validate_task(task: Any, payload: Any) -> None:
    # Validate the type before set membership: JSON arrays/objects are unhashable
    # and must return a controlled 400, never fall through to a 500 handler.
    if not isinstance(task, str) or task not in TASKS or not isinstance(payload, dict):
        raise HTTPException(400, "invalid task")
    if task == "tax_question":
        valid = set(payload) == {"question"} and isinstance(payload.get("question"), str) and bool(payload["question"].strip())
        if valid:
            try:
                valid = len(payload["question"].encode("utf-8")) <= 8000
            except UnicodeEncodeError:
                valid = False
    elif task == "document_summary":
        valid = set(payload) == {"text"} and isinstance(payload.get("text"), str) and bool(payload["text"].strip())
        if valid:
            try:
                valid = len(payload["text"].encode("utf-8")) <= 40000
            except UnicodeEncodeError:
                valid = False
    else:
        valid = set(payload) == {"data"} and isinstance(payload.get("data"), list) and 1 <= len(payload["data"]) <= 500
    if not valid:
        raise HTTPException(400, "invalid task input")
    try:
        encoded_size = len(json.dumps(
            payload, ensure_ascii=False, separators=(",", ":")
        ).encode())
    except (TypeError, ValueError, RecursionError):
        raise HTTPException(400, "invalid task input") from None
    if encoded_size > MAX_INPUT:
        raise HTTPException(413, "task input too large")


@app.get("/health")
def health() -> dict[str, str]:
    # Never report secrets or database details.
    if len(token()) < 32:
        raise HTTPException(503, "worker not configured")
    return {"status": "ok", "execution": "disabled"}


@app.post("/v1/jobs")
async def create_job(request: Request, authorization: str | None = Header(default=None)) -> JSONResponse:
    expected = token()
    if len(expected) < 32:
        raise HTTPException(503, "worker not configured")
    supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(401, "unauthorized")

    # Read incrementally so oversized bodies are rejected before buffering them
    # entirely in memory. Content-Length is not trusted as the only limit.
    chunks: list[bytes] = []
    total = 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > MAX_BODY:
            raise HTTPException(413, "request too large")
        chunks.append(chunk)
    raw = b"".join(chunks)
    try:
        body = json.loads(
            raw,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=reject_nonfinite_constant,
        )
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError, RecursionError):
        raise HTTPException(400, "invalid JSON") from None
    if not isinstance(body, dict) or set(body) != {"task", "input", "request_id", "user_ref"}:
        raise HTTPException(400, "invalid request fields")
    request_id, user_ref = body["request_id"], body["user_ref"]
    if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id):
        raise HTTPException(400, "invalid request id")
    if not isinstance(user_ref, str) or not user_ref or len(user_ref) > 128:
        raise HTTPException(400, "invalid user reference")
    try:
        user_ref.encode("utf-8")
    except UnicodeEncodeError:
        raise HTTPException(400, "invalid user reference") from None
    validate_task(body["task"], body["input"])

    connection = db()
    try:
        # Serialize the idempotency and capacity checks. Without an immediate
        # write transaction, concurrent requests could all observe spare capacity
        # and push the queue beyond its hard limit.
        connection.execute("BEGIN IMMEDIATE")
        existing = connection.execute(
            "SELECT job_id, user_ref, task, payload_json FROM jobs WHERE request_id=?",
            (request_id,),
        ).fetchone()
        if existing:
            same_request = (
                existing[1] == user_ref
                and existing[2] == body["task"]
                and existing[3] == json.dumps(
                    body["input"], ensure_ascii=False, sort_keys=True,
                    separators=(",", ":"),
                )
            )
            if not same_request:
                connection.rollback()
                raise HTTPException(409, "request id conflict")
            connection.commit()
            return JSONResponse({"job_id": existing[0]}, status_code=202)
        queued_count = connection.execute(
            "SELECT COUNT(*) FROM jobs WHERE status='queued'"
        ).fetchone()[0]
        if queued_count >= 100:
            connection.rollback()
            raise HTTPException(429, "queue full")
        job_id = secrets.token_urlsafe(24)
        connection.execute(
            "INSERT INTO jobs VALUES (?, ?, ?, ?, ?, 'queued', ?)",
            (
                job_id, request_id, user_ref, body["task"],
                json.dumps(
                    body["input"], ensure_ascii=False, sort_keys=True,
                    separators=(",", ":"),
                ),
                int(time.time()),
            ),
        )
        connection.commit()
        restrict_storage_permissions()
        # This is a durable receipt only; no agent execution occurs in this version.
        return JSONResponse({"job_id": job_id}, status_code=202)
    except sqlite3.IntegrityError:
        connection.rollback()
        raise HTTPException(503, "queue unavailable") from None
    except sqlite3.OperationalError:
        connection.rollback()
        raise HTTPException(503, "queue temporarily unavailable") from None
    finally:
        connection.close()


@app.post("/internal/worker/claim")
def worker_claim(authorization: str | None = Header(default=None)) -> dict[str, Any]:
    if not _service_authorized(authorization):
        raise HTTPException(401, "unauthorized")
    job = claim_next_job()
    return {"job": job}


@app.post("/internal/worker/{job_id}/complete")
def worker_complete(job_id: str, body: dict[str, Any],
                    authorization: str | None = Header(default=None)) -> dict[str, str]:
    if not _service_authorized(authorization):
        raise HTTPException(401, "unauthorized")
    if set(body) != {"lease_token", "result"}:
        raise HTTPException(400, "invalid completion fields")
    status = finish_job(job_id, body["lease_token"], result=body["result"])
    return {"status": status}


@app.post("/internal/worker/{job_id}/fail")
def worker_fail(job_id: str, body: dict[str, Any],
                authorization: str | None = Header(default=None)) -> dict[str, str]:
    if not _service_authorized(authorization):
        raise HTTPException(401, "unauthorized")
    if set(body) != {"lease_token", "error_code"}:
        raise HTTPException(400, "invalid failure fields")
    status = finish_job(job_id, body["lease_token"], error_code=body["error_code"])
    return {"status": status}


@app.exception_handler(Exception)
async def safe_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    # Avoid leaking tracebacks, payloads, or credentials to clients.
    return JSONResponse({"detail": "internal error"}, status_code=500)


@app.get("/v1/jobs/{job_id}")
def get_job_status(
    job_id: str,
    user_ref: str = Header(alias="X-User-Ref"),
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    """Return minimal status for the authenticated owner; never return task payloads."""
    expected = token()
    supplied = authorization[7:] if authorization and authorization.startswith("Bearer ") else ""
    if len(expected) < 32:
        raise HTTPException(503, "worker not configured")
    if not supplied or not hmac.compare_digest(supplied, expected):
        raise HTTPException(401, "unauthorized")
    if not JOB_ID_RE.fullmatch(job_id) or not user_ref or len(user_ref) > 128:
        raise HTTPException(404, "job not found")

    connection = db()
    try:
        row = connection.execute(
            "SELECT task, status, created_at FROM jobs WHERE job_id=? AND user_ref=?",
            (job_id, user_ref),
        ).fetchone()
        if row is None:
            # Same response for unknown jobs and jobs belonging to another user.
            raise HTTPException(404, "job not found")
        return {"job_id": job_id, "task": row[0], "status": row[1], "created_at": row[2]}
    finally:
        connection.close()
