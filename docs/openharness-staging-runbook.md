# OpenHarness staging deployment runbook

Status: preparation only. This document does not authorize production deployment or feature activation.

## Hard prerequisites

1. A dedicated Linux host that supports Docker Engine and Docker Compose v2. The current Declarafy Namecheap/cPanel PHP hosting is not the worker runtime.
2. A reviewed private HTTPS ingress/proxy between the cPanel PHP bridge and the worker's internal Docker network. The Compose profile publishes no host port by design.
3. A secret-management procedure for the worker service token and AES-256 keyring, plus secure distribution of the matching service token to the PHP server.
4. A staging database volume copy if legacy queue rows exist. Never test migration on the only copy of a live database.
5. A human-approved decision on the OpenHarness runtime, tool allow-list, sandbox, resource limits, provider budget, and end-user UI. The current worker deliberately reports execution disabled.

## Prepare runtime secrets

On the dedicated worker host, create the secret files without printing secret values or placing them in shell arguments:

```bash
sudo install -d -o 10001 -g 10001 -m 0700 /etc/declarafy-worker
sudo python3 - <<'PY'
import base64, json, secrets
from pathlib import Path
root = Path("/etc/declarafy-worker")
(root / "worker-token").write_text(secrets.token_hex(32), encoding="utf-8")
keyring = {"k2026-10": base64.b64encode(secrets.token_bytes(32)).decode("ascii")}
(root / "encryption-keyring.json").write_text(json.dumps(keyring), encoding="utf-8")
PY
sudo chown 10001:10001 /etc/declarafy-worker/worker-token /etc/declarafy-worker/encryption-keyring.json
sudo chmod 0400 /etc/declarafy-worker/worker-token /etc/declarafy-worker/encryption-keyring.json
```

Create a protected Compose environment file containing only file paths and the non-secret active key ID, owned by the administrator who runs Compose:

```dotenv
DECLARAFY_WORKER_TOKEN_FILE=/etc/declarafy-worker/worker-token
DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON_FILE=/etc/declarafy-worker/encryption-keyring.json
DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID=k2026-10
```

Protect that environment file (mode 0600). Verify the host's Compose secret-file mounts are readable by UID/GID 10001 and are not readable by unrelated host users. The PHP server must receive the matching worker token through its own protected server-side configuration; never put it in browser code or Git.

## Build and start an isolated staging worker

From the repository root on the worker host:

```bash
sudo docker compose --env-file /etc/declarafy-worker/worker.env -f worker/docker-compose.hardened.yml config --quiet
docker compose --env-file /etc/declarafy-worker/worker.env -f worker/docker-compose.hardened.yml build
docker compose --env-file /etc/declarafy-worker/worker.env -f worker/docker-compose.hardened.yml up -d
docker compose --env-file /etc/declarafy-worker/worker.env -f worker/docker-compose.hardened.yml ps
```

The service has no published host port and no outbound network access. Do not publish port 8080 to make it reachable. Attach only a reviewed private proxy to the worker's internal network, and separately verify TLS, source allow-listing, DNS resolution, firewall policy, and egress restrictions. The PHP bridge cannot connect to the worker until this private ingress is designed and tested.

## Migrate an existing queue

Run only during a maintenance window with the worker stopped and a protected copy of the volume available:

```bash
docker compose --env-file /etc/declarafy-worker/worker.env -f worker/docker-compose.hardened.yml stop openharness-worker
docker compose --env-file /etc/declarafy-worker/worker.env -f worker/docker-compose.hardened.yml run --rm --no-deps --entrypoint python openharness-worker /app/migrate_encryption.py
docker compose --env-file /etc/declarafy-worker/worker.env -f worker/docker-compose.hardened.yml run --rm --no-deps --entrypoint python openharness-worker /app/migrate_encryption.py --apply
```

The first command is read-only and reports how many rows need encryption or key rotation. The second creates a mode-0600 database backup and applies the migration transactionally. Preserve that backup under the approved retention policy; it may contain legacy plaintext. Keep every old key ID in the keyring until migration is verified and no retained ciphertext needs it. Start the worker only after checking the migrated database and backup.

## PHP bridge configuration

Only after the private ingress and TLS path are approved, configure the PHP server-side values:
- `openharness_enabled = '0'` during staging preparation.
- `openharness_url` set to the private HTTPS proxy hostname.
- `openharness_allowed_hosts` containing that exact hostname.
- `openharness_token` set to the matching worker service token through protected server-side configuration.

The application feature flag must remain OFF during staging. First validate authenticated submit, owner-scoped status, cancellation, and owner-scoped result retrieval using synthetic data. Do not submit real RUC-linked, taxpayer, payroll, or client documents.

## Release blockers that this runbook does not solve

- OpenHarness agent execution is not implemented; the worker currently queues jobs and reports `execution: disabled`.
- No end-user polling/result presentation workflow is wired.
- No actual staging host, private proxy, production secret store, or PHP-to-worker network path is provisioned by this repository change.
- Workspace isolation, command/tool deny rules, agent concurrency, model/provider budgets, hard deadlines, process-level cancellation, and OpenHarness-version security review remain outstanding.
- The PHP-to-worker-to-PHP flow still needs an end-to-end staging test with synthetic data and an independent security review.

Do not merge, deploy, or turn on the feature until all release gates are checked and explicitly approved.
