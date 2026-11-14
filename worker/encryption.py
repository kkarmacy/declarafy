"""Versioned AES-256-GCM envelope encryption for worker task fields.

Keys are supplied as base64-encoded 32-byte values in
DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON, keyed by an opaque key ID. The active
key ID is DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID. Never store keys here.
"""
from __future__ import annotations

import base64
import binascii
import json
import os
import re
import secrets
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_PREFIX = "enc:v1:"
_KEY_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")


class EncryptionConfigurationError(RuntimeError):
    """Missing or invalid external encryption key configuration."""


class EncryptedDataError(RuntimeError):
    """Ciphertext is malformed, legacy plaintext, or failed authentication."""


def _keyring() -> tuple[str, dict[str, bytes]]:
    raw = os.environ.get("DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON", "")
    keyring_file = os.environ.get("DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON_FILE", "")
    if not raw and keyring_file:
        try:
            raw = Path(keyring_file).read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            raise EncryptionConfigurationError("worker encryption keyring file is unavailable") from None
    active = os.environ.get("DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID", "")
    if not raw or not active or len(raw.encode("utf-8")) > 16_384:
        raise EncryptionConfigurationError("worker encryption keys are not configured")
    try:
        encoded = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        raise EncryptionConfigurationError("invalid worker encryption keyring") from None
    if not isinstance(encoded, dict) or not encoded or active not in encoded:
        raise EncryptionConfigurationError("active worker encryption key is unavailable")
    keys: dict[str, bytes] = {}
    for key_id, value in encoded.items():
        if not isinstance(key_id, str) or not _KEY_ID_RE.fullmatch(key_id) or not isinstance(value, str):
            raise EncryptionConfigurationError("invalid worker encryption key entry")
        try:
            key = base64.b64decode(value, validate=True)
        except (ValueError, binascii.Error):
            raise EncryptionConfigurationError("invalid worker encryption key encoding") from None
        if len(key) != 32:
            raise EncryptionConfigurationError("worker encryption keys must be 32 bytes")
        keys[key_id] = key
    return active, keys


def encrypt_field(job_id: str, field_name: str, plaintext: str) -> str:
    if not isinstance(job_id, str) or not job_id or field_name not in {"payload_json", "result_json"}:
        raise ValueError("invalid encryption context")
    if not isinstance(plaintext, str):
        raise TypeError("plaintext must be text")
    active, keys = _keyring()
    nonce = secrets.token_bytes(12)
    aad = f"declarafy-worker|{job_id}|{field_name}|v1".encode("utf-8")
    ciphertext = AESGCM(keys[active]).encrypt(nonce, plaintext.encode("utf-8"), aad)
    token = base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii").rstrip("=")
    return f"{_PREFIX}{active}:{token}"


def decrypt_field(job_id: str, field_name: str, envelope: str) -> str:
    if not isinstance(job_id, str) or not job_id or field_name not in {"payload_json", "result_json"}:
        raise ValueError("invalid encryption context")
    if not isinstance(envelope, str) or not envelope.startswith(_PREFIX):
        raise EncryptedDataError("legacy plaintext or unsupported ciphertext; controlled migration required")
    try:
        key_id, token = envelope[len(_PREFIX):].split(":", 1)
        if not _KEY_ID_RE.fullmatch(key_id):
            raise ValueError
        _, keys = _keyring()
        key = keys.get(key_id)
        if key is None:
            raise EncryptionConfigurationError("ciphertext key ID is not configured")
        padded = token + "=" * (-len(token) % 4)
        packed = base64.b64decode(padded, altchars=b"-_", validate=True)
        if len(packed) < 12 + 16:
            raise ValueError
        nonce, ciphertext = packed[:12], packed[12:]
        aad = f"declarafy-worker|{job_id}|{field_name}|v1".encode("utf-8")
        return AESGCM(key).decrypt(nonce, ciphertext, aad).decode("utf-8")
    except EncryptionConfigurationError:
        raise
    except (ValueError, UnicodeDecodeError, InvalidTag, binascii.Error):
        raise EncryptedDataError("ciphertext authentication failed") from None
