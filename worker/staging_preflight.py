"""Read-only preflight for a dedicated OpenHarness staging worker.

Run inside the worker container before connecting PHP. This validates local
secret/storage configuration only; it does not prove network, TLS, proxy,
sandbox, or production readiness.
"""
from __future__ import annotations

import json
import os
import sqlite3
import stat
import sys
from pathlib import Path
from typing import Any

from encryption import (
    EncryptedDataError,
    EncryptionConfigurationError,
    decrypt_field,
    encrypt_field,
)

DATA_DIR = Path(os.environ.get("WORKER_DATA_DIR", "/var/lib/declarafy-worker"))
DB_PATH = DATA_DIR / "jobs.sqlite3"


class PreflightFailure(RuntimeError):
    pass


def _private_regular_file(env_name: str, label: str) -> Path:
    raw_path = os.environ.get(env_name, "")
    if not raw_path:
        raise PreflightFailure(f"{label}: file path is not configured")
    path = Path(raw_path)
    try:
        info = path.lstat()
    except OSError:
        raise PreflightFailure(f"{label}: file is unavailable") from None
    if not stat.S_ISREG(info.st_mode):
        raise PreflightFailure(f"{label}: must be a regular file (not a symlink)")
    if info.st_mode & 0o077:
        raise PreflightFailure(f"{label}: permissions must exclude group and other users")
    return path


def _check_service_token() -> None:
    path = _private_regular_file("DECLARAFY_WORKER_TOKEN_FILE", "worker token")
    try:
        value = path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        raise PreflightFailure("worker token: unreadable or invalid text") from None
    if len(value) < 32 or len(value) > 4096:
        raise PreflightFailure("worker token: must contain 32 to 4096 characters")


def _check_keyring() -> None:
    path = _private_regular_file(
        "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON_FILE", "encryption keyring"
    )
    # Force the encryption module to load the mounted file, never print its data.
    if not path.is_file():
        raise PreflightFailure("encryption keyring: unavailable")
    try:
        probe = encrypt_field("staging-preflight", "payload_json", "{}")
        if decrypt_field("staging-preflight", "payload_json", probe) != "{}":
            raise PreflightFailure("encryption self-test failed")
    except (EncryptionConfigurationError, EncryptedDataError, ValueError):
        raise PreflightFailure("encryption keyring: invalid or unusable") from None


def _check_storage() -> None:
    try:
        info = DATA_DIR.lstat()
    except OSError:
        raise PreflightFailure("worker data directory: does not exist") from None
    if not stat.S_ISDIR(info.st_mode):
        raise PreflightFailure("worker data directory: must be a real directory")
    if info.st_mode & 0o077:
        raise PreflightFailure("worker data directory: permissions must be 0700 or stricter")
    if DB_PATH.exists():
        db_info = DB_PATH.lstat()
        if not stat.S_ISREG(db_info.st_mode) or db_info.st_mode & 0o077:
            raise PreflightFailure("worker database: must be a private regular file")
        try:
            with sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=3) as conn:
                result = conn.execute("PRAGMA quick_check").fetchone()
                if not result or result[0] != "ok":
                    raise PreflightFailure("worker database: SQLite quick_check failed")
                columns = {row[1] for row in conn.execute("PRAGMA table_info(jobs)")}
                if "payload_json" in columns:
                    plaintext = conn.execute(
                        "SELECT COUNT(*) FROM jobs WHERE payload_json NOT LIKE 'enc:v1:%' "
                        "OR (result_json IS NOT NULL AND result_json NOT LIKE 'enc:v1:%')"
                    ).fetchone()[0] if "result_json" in columns else conn.execute(
                        "SELECT COUNT(*) FROM jobs WHERE payload_json NOT LIKE 'enc:v1:%'"
                    ).fetchone()[0]
                    if plaintext:
                        raise PreflightFailure(
                            f"worker database: {plaintext} legacy/plaintext row(s) require migration"
                        )
        except sqlite3.Error:
            raise PreflightFailure("worker database: cannot be checked read-only") from None


def run_preflight() -> dict[str, Any]:
    checks = []
    for name, check in (
        ("service_token", _check_service_token),
        ("encryption_keyring", _check_keyring),
        ("private_storage", _check_storage),
    ):
        try:
            check()
            checks.append({"name": name, "status": "pass"})
        except PreflightFailure as exc:
            checks.append({"name": name, "status": "fail", "reason": str(exc)})
    return {
        "ready_for_synthetic_staging_checks": all(x["status"] == "pass" for x in checks),
        "checks": checks,
        "limitations": [
            "does not verify private ingress, TLS, DNS, firewall, or network egress",
            "does not verify OpenHarness execution, sandboxing, quotas, or process cancellation",
            "does not authorize production data, feature activation, or deployment",
        ],
    }


def main() -> int:
    report = run_preflight()
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["ready_for_synthetic_staging_checks"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
