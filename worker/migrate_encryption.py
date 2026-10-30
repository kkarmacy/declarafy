"""Explicit, backed-up migration of legacy plaintext worker queue fields.

Run from the worker image with its external encryption keyring configured:
    python /app/migrate_encryption.py          # inspect only
    python /app/migrate_encryption.py --apply  # backup then encrypt in one DB transaction
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import sqlite3
import stat

from encryption import (
    EncryptedDataError,
    EncryptionConfigurationError,
    decrypt_field,
    encrypt_field,
)
APP_DIR = Path(os.environ.get("WORKER_DATA_DIR", "/var/lib/declarafy-worker"))
DB_PATH = APP_DIR / "jobs.sqlite3"


def migrate(apply: bool = False) -> tuple[int, Path | None]:
    if not DB_PATH.exists():
        raise FileNotFoundError("worker database does not exist")
    # Validate the configured active key before making a backup or touching rows.
    probe = encrypt_field("migration-probe", "payload_json", "{}")
    if decrypt_field("migration-probe", "payload_json", probe) != "{}":
        raise EncryptionConfigurationError("encryption self-check failed")

    connection = sqlite3.connect(DB_PATH, timeout=10)
    backup_path: Path | None = None
    try:
        rows = connection.execute(
            "SELECT job_id, payload_json, result_json FROM jobs ORDER BY job_id"
        ).fetchall()
        updates: list[tuple[str, str | None, str]] = []
        for job_id, payload, result in rows:
            encrypted_payload = payload
            encrypted_result = result
            if not payload.startswith("enc:v1:"):
                encrypted_payload = encrypt_field(job_id, "payload_json", payload)
            else:
                decrypt_field(job_id, "payload_json", payload)
            if result is not None:
                if not result.startswith("enc:v1:"):
                    encrypted_result = encrypt_field(job_id, "result_json", result)
                else:
                    decrypt_field(job_id, "result_json", result)
            if encrypted_payload != payload or encrypted_result != result:
                updates.append((encrypted_payload, encrypted_result, job_id))

        if not apply or not updates:
            return len(updates), None

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_path = APP_DIR / f"jobs.sqlite3.pre-encryption-{stamp}.bak"
        backup = sqlite3.connect(backup_path)
        try:
            connection.backup(backup)
        finally:
            backup.close()
        os.chmod(backup_path, stat.S_IRUSR | stat.S_IWUSR)

        connection.execute("BEGIN IMMEDIATE")
        for payload, result, job_id in updates:
            connection.execute(
                "UPDATE jobs SET payload_json=?, result_json=? WHERE job_id=?",
                (payload, result, job_id),
            )
        connection.commit()
        return len(updates), backup_path
    except Exception:
        connection.rollback()
        if backup_path is not None:
            # Keep the backup as forensic recovery material if the transaction fails.
            pass
        raise
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="create a protected backup and encrypt legacy rows")
    args = parser.parse_args()
    try:
        count, backup = migrate(apply=args.apply)
    except (EncryptedDataError, EncryptionConfigurationError, sqlite3.Error, OSError) as exc:
        print(f"migration_failed={type(exc).__name__}")
        return 2
    print(f"rows_requiring_encryption={count}")
    if args.apply:
        print("migration_applied=yes")
        print(f"backup_created={'yes' if backup else 'not-needed'}")
    else:
        print("dry_run_only=yes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
