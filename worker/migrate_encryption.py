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
    active_key_id = os.environ.get("DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID", "")
    active_prefix = f"enc:v1:{active_key_id}:"

    connection = sqlite3.connect(DB_PATH, timeout=10)
    backup_path: Path | None = None
    try:
        columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
        if not columns:
            raise sqlite3.OperationalError("worker jobs table is missing")
        needs_result_column = "result_json" not in columns
        result_expression = "NULL" if needs_result_column else "result_json"
        rows = connection.execute(
            f"SELECT job_id, payload_json, {result_expression} FROM jobs ORDER BY job_id"
        ).fetchall()
        updates: list[tuple[str, str | None, str]] = []
        for job_id, payload, result in rows:
            encrypted_payload = payload
            encrypted_result = result
            if not payload.startswith("enc:v1:"):
                encrypted_payload = encrypt_field(job_id, "payload_json", payload)
            else:
                plaintext_payload = decrypt_field(job_id, "payload_json", payload)
                if not payload.startswith(active_prefix):
                    encrypted_payload = encrypt_field(job_id, "payload_json", plaintext_payload)
            if result is not None:
                if not result.startswith("enc:v1:"):
                    encrypted_result = encrypt_field(job_id, "result_json", result)
                else:
                    plaintext_result = decrypt_field(job_id, "result_json", result)
                    if not result.startswith(active_prefix):
                        encrypted_result = encrypt_field(job_id, "result_json", plaintext_result)
            if encrypted_payload != payload or encrypted_result != result:
                updates.append((encrypted_payload, encrypted_result, job_id))

        if not apply or (not updates and not needs_result_column):
            return len(updates), None

        os.chmod(APP_DIR, 0o700)
        os.chmod(DB_PATH, 0o600)
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
        backup_path = APP_DIR / f"jobs.sqlite3.pre-encryption-{stamp}.bak"
        backup = sqlite3.connect(backup_path)
        try:
            connection.backup(backup)
        finally:
            backup.close()
        os.chmod(backup_path, stat.S_IRUSR | stat.S_IWUSR)

        connection.execute("PRAGMA secure_delete=ON")
        connection.execute("BEGIN IMMEDIATE")
        if needs_result_column:
            connection.execute("ALTER TABLE jobs ADD COLUMN result_json TEXT")
        for payload, result, job_id in updates:
            connection.execute(
                "UPDATE jobs SET payload_json=?, result_json=? WHERE job_id=?",
                (payload, result, job_id),
            )
        connection.commit()
        # Best-effort cleanup of prior plaintext pages in the WAL after the
        # committed rewrite. Backups remain separately protected/retained.
        connection.execute("PRAGMA wal_checkpoint(TRUNCATE)")
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
