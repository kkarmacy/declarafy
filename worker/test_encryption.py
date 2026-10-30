import base64
import json
import os
import unittest
from unittest.mock import patch

from encryption import (
    EncryptedDataError,
    EncryptionConfigurationError,
    decrypt_field,
    encrypt_field,
)


def encoded_key(byte):
    return base64.b64encode(bytes([byte]) * 32).decode("ascii")


class EncryptionTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": json.dumps({"key-a": encoded_key(1)}),
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "key-a",
        })
        self.env.start()
        self.addCleanup(self.env.stop)

    def test_round_trip_and_random_nonce(self):
        first = encrypt_field("job-123", "payload_json", '{"secret":"synthetic"}')
        second = encrypt_field("job-123", "payload_json", '{"secret":"synthetic"}')
        self.assertNotEqual(first, second)
        self.assertEqual(decrypt_field("job-123", "payload_json", first), '{"secret":"synthetic"}')

    def test_ciphertext_is_bound_to_job_and_column(self):
        envelope = encrypt_field("job-123", "payload_json", '{"x":1}')
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-456", "payload_json", envelope)
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-123", "result_json", envelope)

    def test_tampering_fails_authentication(self):
        envelope = encrypt_field("job-123", "result_json", '{"x":1}')
        replacement = "A" if envelope[-1] != "A" else "B"
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-123", "result_json", envelope[:-1] + replacement)

    def test_missing_key_configuration_fails_closed(self):
        with patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": "",
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "",
        }):
            with self.assertRaises(EncryptionConfigurationError):
                encrypt_field("job-123", "payload_json", "{}")

    def test_key_rotation_reads_old_and_writes_new(self):
        old = encrypt_field("job-123", "payload_json", '{"x":1}')
        with patch.dict(os.environ, {
            "DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON": json.dumps({
                "key-a": encoded_key(1), "key-b": encoded_key(2)
            }),
            "DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID": "key-b",
        }):
            new = encrypt_field("job-123", "payload_json", '{"x":2}')
            self.assertTrue(new.startswith("enc:v1:key-b:"))
            self.assertEqual(decrypt_field("job-123", "payload_json", old), '{"x":1}')
            self.assertEqual(decrypt_field("job-123", "payload_json", new), '{"x":2}')

    def test_legacy_plaintext_is_rejected_not_silently_read(self):
        with self.assertRaises(EncryptedDataError):
            decrypt_field("job-123", "payload_json", '{"legacy":"plaintext"}')


if __name__ == "__main__":
    unittest.main()
