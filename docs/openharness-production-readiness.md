# OpenHarness production-readiness controls

Status: engineering checklist for the isolated integration spike. This document does not authorize deployment or activation.

## Current implementation boundary

The current worker is an authenticated ingress and SQLite queue only. It validates bounded task envelopes and returns job receipts. It does not execute OpenHarness, retrieve results, or provide a complete tax-agent workflow. The PHP bridge is feature-flagged OFF by default.

## Required storage protection before real tax data

- Do not submit real taxpayer documents, RUC-linked records, credentials, or confidential client data to this prototype.
- SQLite currently stores task input in plaintext in `payload_json`. Directory/file modes (0700/0600) reduce access by other local users but are not encryption at rest.
- Before accepting sensitive data, encrypt each payload using authenticated encryption (for example, AES-256-GCM or an established envelope-encryption library). Never implement custom cryptography.
- Keep encryption keys outside the database, image, repository, and task payloads; use a managed secret/KMS facility where available. Define rotation and recovery procedures.
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

- [ ] Encryption-at-rest implementation and key rotation tests pass.
- [ ] Retention/expiry/deletion tests include SQLite WAL/SHM and backups.
- [ ] Runtime policy proves read-only root, no host mounts, non-root, dropped capabilities, no-new-privileges, and restricted network egress.
- [ ] Workspace tests cover absolute paths, traversal, symlinks, and cross-job access.
- [ ] Concurrency, queue, CPU/memory/time, output, and per-job spend limits are enforced and tested.
- [ ] Secret scanning confirms credentials do not appear in logs, task storage, process arguments, artifacts, or responses.
- [ ] PHP-to-worker-to-result end-to-end test passes in staging with synthetic data only.
- [ ] Security review signs off on the exact OpenHarness version and tool allow-list.
- [ ] Feature flag remains OFF until every gate is checked and release approval is recorded.

## Explicit no-go conditions

Do not deploy or enable the integration while task payloads are plaintext, agent execution is not sandboxed, provider spend is unbounded, result retrieval is unimplemented, or staging acceptance is incomplete. The current prototype is not a production tax-advisory service.
