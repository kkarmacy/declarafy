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


def db() -> sqlite3.Connection:
    APP_DIR.mkdir(mode=0o700, parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=5)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("""CREATE TABLE IF NOT EXISTS jobs (
        job_id TEXT PRIMARY KEY,
        request_id TEXT NOT NULL UNIQUE,
        user_ref TEXT NOT NULL,
        task TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL
    )""")
    connection.commit()
    return connection


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key")
        result[key] = value
    return result


def validate_task(task: Any, payload: Any) -> None:
    # Validate the type before set membership: JSON arrays/objects are unhashable
    # and must return a controlled 400, never fall through to a 500 handler.
    if not isinstance(task, str) or task not in TASKS or not isinstance(payload, dict):
        raise HTTPException(400, "invalid task")
    if task == "tax_question":
        valid = set(payload) == {"question"} and isinstance(payload.get("question"), str) and bool(payload["question"].strip()) and len(payload["question"].encode()) <= 8000
    elif task == "document_summary":
        valid = set(payload) == {"text"} and isinstance(payload.get("text"), str) and bool(payload["text"].strip()) and len(payload["text"].encode()) <= 40000
    else:
        valid = set(payload) == {"data"} and isinstance(payload.get("data"), list) and 1 <= len(payload["data"]) <= 500
    if not valid:
        raise HTTPException(400, "invalid task input")
    if len(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()) > MAX_INPUT:
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
        body = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError):
        raise HTTPException(400, "invalid JSON") from None
    if not isinstance(body, dict) or set(body) != {"task", "input", "request_id", "user_ref"}:
        raise HTTPException(400, "invalid request fields")
    request_id, user_ref = body["request_id"], body["user_ref"]
    if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id):
        raise HTTPException(400, "invalid request id")
    if not isinstance(user_ref, str) or not user_ref or len(user_ref) > 128:
        raise HTTPException(400, "invalid user reference")
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
                and existing[3] == json.dumps(body["input"], ensure_ascii=False)
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
            (job_id, request_id, user_ref, body["task"], json.dumps(body["input"], ensure_ascii=False), int(time.time())),
        )
        connection.commit()
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


@app.exception_handler(Exception)
async def safe_unexpected_error(request: Request, exc: Exception) -> JSONResponse:
    # Avoid leaking tracebacks, payloads, or credentials to clients.
    return JSONResponse({"detail": "internal error"}, status_code=500)


@app.get("/v1/jobs/{job_id}")
def get_job_status(
    job_id: str,
    user_ref: str,
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
