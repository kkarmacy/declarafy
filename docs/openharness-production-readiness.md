# OpenHarness production-readiness controls

Status: engineering checklist for the isolated integration spike. This document does not authorize deployment or activation.

## Current implementation boundary

The current worker is an authenticated ingress and SQLite queue with a tested lease-based lifecycle. It supports atomic claim, running/completed/failed transitions, bounded retries, expired-lease recovery, and owner-scoped status metadata through PHP. It does not execute OpenHarness automatically or expose result bodies through PHP. The PHP bridge is feature-flagged OFF by default.

## Required storage protection before real tax data

- Do not submit real taxpayer documents, RUC-linked records, credentials, or confidential client data to this prototype.
- The integration branch now encrypts new `payload_json` and `result_json` values with AES-256-GCM. Existing plaintext rows still require the explicit backup-first migration documented below; do not process them through the worker before migration.
- Keep encryption keys outside the database, image, repository, and task payloads; inject them through a managed secret/KMS facility where available. Define rotation and recovery procedures.
- Define retention by task class, automatic expiry, deletion of expired rows and associated SQLite WAL/SHM data, backup expiry, and a verified deletion process.
- Do not log prompts, documents, tax rows, tokens, or provider responses. Logs should contain only opaque IDs, timestamps, status, and sanitized error categories.
- Document data residency, authorized operators, incident response, and customer disclosure before production use.

## Runtime isolation requirements

A Dockerfile alone does not enforce runtime isolation. The deployment platform must enforce all of the following, and evidence must be attached to the release review:

- Run as non-root; drop Linux capabilities; enable `no-new-privileges`; apply seccomp/AppArmor or an equivalent mandatory access policy.
- Use a read-only root filesystem and a dedicated, size-limited writable volume for the queue/workspace.
- Do not mount host directories, production application files, Docker/container sockets, or Declarafy database credentials.
- Place the worker on a private network. Permit inbound traffic only from the authenticated PHP bridge/proxy and outbound traffic only to explicitly approved model endpoints.
- Terminate TLS at a trusted proxy; enforce authentication, request limits, and rate limits at both the bridge and worker.
- Apply CPU, memory, process, disk, execution-time, queue-depth, and concurrency limits.
- Use a disposable workspace per job; reject absolute paths, traversal, and symlink escapes. Never expose general shell, browser, MCP, or arbitrary filesystem tools to tax tasks by default.
- Keep provider keys in secret storage, rotate them, and ensure they are absent from process arguments, logs, task records, and user-visible responses.

## Execution and result controls

- Keep execution disabled until a reviewed task runner exists.
- Define allow-listed agent/tool configurations per task type outside user-controlled input.
- Enforce per-user quotas and per-job model/token/spend budgets before dispatch; cap parallel agents and total in-flight jobs.
- Enforce hard deadlines, cancellation, bounded output, schema validation, and sanitization before a result can be returned to Declarafy.
- Persist state transitions and audit events without raw tax data. Ensure retries are idempotent and ownership is checked on every status/result read.
- Treat model output as untrusted: no automatic tax filing, payment, SUNAT submission, or legal conclusion without deterministic validation and explicit human approval.

## Staging acceptance gates

- [x] AES-256-GCM field encryption and key rotation/re-encryption tests pass in the integration branch; managed key custody and production rotation/restore drills remain open.
- [ ] Retention/expiry/deletion tests include SQLite WAL/SHM and backups.
- [ ] Runtime policy proves read-only root, no host mounts, non-root, dropped capabilities, no-new-privileges, and restricted network egress.
- [ ] Workspace tests cover absolute paths, traversal, symlinks, and cross-job access.
- [ ] Concurrency, queue, CPU/memory/time, output, and per-job spend limits are enforced and tested.
- [ ] Secret scanning confirms credentials do not appear in logs, task storage, process arguments, artifacts, or responses.
- [ ] PHP-to-worker-to-result end-to-end test passes in staging with synthetic data only. The current synthetic worker-level create/claim/complete/status path is tested, but the PHP-to-worker result-body path is not complete.
- [ ] Security review signs off on the exact OpenHarness version and tool allow-list.
- [ ] Feature flag remains OFF until every gate is checked and release approval is recorded.

## Explicit no-go conditions

Do not deploy or enable the integration while task payloads are plaintext, agent execution is not sandboxed, provider spend is unbounded, result retrieval is unimplemented, or staging acceptance is incomplete. The current prototype is not a production tax-advisory service.

## PHP bridge destination configuration

The bridge now requires an exact DNS-host allow-list in addition to HTTPS and port 443. Configure both values on the PHP server only, for example:

```php
'openharness_url' => 'https://worker.example.net',
'openharness_allowed_hosts' => ['worker.example.net'],
'openharness_enabled' => '0',
```

Alternatively, set `DECLARAFY_OPENHARNESS_ALLOWED_HOSTS=worker.example.net` in the server environment. Multiple exact hostnames may be comma-separated. Do not include schemes, ports, paths, wildcards, or user-controlled values in this allow-list. The hostname in `openharness_url` must match one entry exactly. Keep the feature flag OFF until the full release gate is approved.

This application-level check is not sufficient by itself to defeat DNS rebinding or a compromised DNS resolver. The worker hosting environment must also enforce outbound network policy that blocks loopback, private, link-local, multicast, and other non-public/reserved address ranges, including IPv6, and permits only the approved worker destination. Prefer a controlled egress proxy or a platform that pins/validates resolved destinations at connection time. Do not assume that an exact hostname allow-list replaces network-layer egress controls.

## Current bridge verification

The bridge static checks verify HTTPS, reject direct IP literals, reject non-443 ports, and require exact membership in the configured hostname allow-list. CI passing proves those code-level checks only; it does not prove the production DNS resolver, routing, firewall, TLS certificate, or worker host configuration is safe.


## Queue lifecycle implemented; production gates remain

The worker now performs atomic claims under SQLite `BEGIN IMMEDIATE`, assigns a 120-second lease, and uses a lease token bound to the service secret so stale attempts cannot overwrite a newer attempt. Worker failures are retried with bounded backoff up to three attempts. Expired running leases are recovered on the next claim; jobs are requeued while attempts remain and become terminal `failed` after the cap. The owner-scoped status endpoint reports lifecycle state, attempt count, timestamps, and sanitized error code. The PHP bridge exposes this status lookup using the authenticated server-side user ID. A completed result remains stored internally and is not exposed by either status endpoint.

Synthetic tests cover submit → claim → complete → status, submit → fail/retry, expired lease recovery, stale lease rejection, attempt exhaustion, and authenticated internal worker endpoints. These tests validate the lifecycle primitive only; they do not prove a continuously running consumer, OpenHarness execution, or production hosting isolation.

Still outstanding before production: managed key storage and operational key rotation/restore drills, verified WAL/SHM/backup cleanup, the front-end polling/display workflow and end-to-end PHP-to-worker result verification, always-on worker orchestration, resource/cost controls, and staging network/runtime isolation. Cancellation and lease renewal exist as queue-state primitives, but real process interruption is not implemented. Do not enable live submissions. The feature flag remains OFF and the queue must only be exercised with synthetic data.


## Retention cleanup (prototype)

The worker exposes a callable `prune_terminal_jobs(now=None)` maintenance function with a fixed 30-day retention window. It deletes `completed`, `failed`, and `cancelled` records whose `updated_at` is at or before the cutoff; queued and running work is never eligible. It enables SQLite secure-delete for the cleanup transaction and requests WAL truncation afterward. The function is not exposed over HTTP. A separate scheduled container can reuse the worker image with command `python /app/maintenance.py`; it must use the same persistent worker data volume and a single maintenance instance at a time. WAL truncation is best-effort when SQLite reports a busy checkpoint. This is not a claim of cryptographic erasure from filesystem snapshots, backups, storage media, or prior WAL copies; encryption-at-rest and backup retention controls remain mandatory before sensitive data use.


## Lease renewal and cancellation

The prototype now supports 120-second lease renewal for a currently valid token and owner-scoped cancellation through the authenticated PHP bridge. Cancellation atomically marks queued/running jobs as `cancelled` and clears the lease, so a stale worker cannot renew or commit a result. Repeated cancellation is idempotent; terminal jobs cannot be cancelled. This is state-level cooperative cancellation only: there is no OpenHarness process to terminate yet, and a future executor must implement process interruption and cleanup. The PHP route remains behind the feature flag and mutation-security/session checks.

## Authenticated encryption implementation in the integration spike

The worker now includes a versioned AES-256-GCM field-encryption primitive. New queue inputs (payload_json) and completed outputs (result_json) are encrypted before SQLite persistence. Each ciphertext is authenticated with additional context binding it to the job ID and exact column name; each encryption uses a fresh 96-bit nonce. Ciphertext carries a format version and key ID so old keys can remain available during rotation while new writes use the configured active key.

The worker requires both external environment settings before accepting or claiming work:

- DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON: JSON object mapping key IDs to base64-encoded 32-byte keys.
- DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID: key ID used for new writes.

These values must be injected by the deployment secret manager/runtime, never committed to Git, baked into the image, or stored in SQLite. Keep previous key IDs in the keyring until all ciphertext encrypted under them has expired or has been re-encrypted. Removing a key prematurely makes its records unreadable. The worker health check now reports unavailable if encryption is not configured.

Legacy plaintext is rejected by normal queue reads and idempotency checks; the worker does not silently fall back to plaintext. An explicit migration utility is included:

- python /app/migrate_encryption.py performs a dry run and reports only the number of rows requiring encryption.
- python /app/migrate_encryption.py --apply creates a mode-0600 SQLite backup, encrypts legacy plaintext fields, and re-encrypts ciphertext using a previous key ID with the currently active key, transactionally. Keep old keys configured until this operation has completed and been verified.
- Run it only with the external keyring configured, on a stopped/maintenance-isolated worker using the correct persistent volume. Preserve and separately protect the backup under the approved backup-retention policy.

Automated tests cover AES-GCM round trips, random nonces, tampering/authentication failure, job/column context binding, missing-key rejection, key rotation including actual record re-encryption, encrypted-at-rest queue inputs/results, legacy plaintext fail-closed behavior, and backed-up migration. These tests do not constitute a managed KMS, production key ceremony, backup restore drill, or independent security audit.

The feature remains OFF and no live taxpayer data is authorized. Before any deployment, configure real keys through secret management, rehearse migration and restore on a disposable copy of the exact target volume, verify backup expiry and WAL/SHM handling, and complete the remaining runtime/network/result-pipeline gates.
## Hardened Docker profile (deployment template)

The repository includes worker/docker-compose.hardened.yml for a dedicated Linux Docker host. It runs the worker as the non-root image user, with a read-only root filesystem, no Linux capabilities, no-new-privileges, bounded CPU/memory/process/file descriptors, a small no-exec temporary filesystem, and a dedicated persistent queue volume. The worker is attached only to an internal Docker network; no host port is published.

Supply protected host file paths through DECLARAFY_WORKER_TOKEN_FILE and DECLARAFY_WORKER_ENCRYPTION_KEYS_JSON_FILE, and supply the non-secret active key ID through DECLARAFY_WORKER_ENCRYPTION_ACTIVE_KEY_ID. The application reads the secret files at runtime. Protect those host files and confirm the container runtime makes the mounted secrets readable only to the worker process.

This template intentionally does not publish the worker to the internet or grant it outbound model-provider access. A PHP bridge hosted outside this Docker network cannot reach it as-is. Before connecting Declarafy, design and review a private authenticated proxy or a separately controlled TLS ingress with explicit source allow-listing and egress policy. Do not solve connectivity by publishing port 8080 publicly or attaching an unrestricted network.

The Compose profile is a deployment baseline, not proof that a particular hosting provider supports Docker, enforces the requested policies, or has been configured. The current Namecheap/cPanel website deployment is separate; this worker requires a suitable Linux Docker host and managed runtime secrets.