# OpenHarness worker API contract (v1)

Status: ingress prototype implemented in the feature branch; execution remains disabled and nothing is deployed to production.

## Why a separate worker is mandatory

OpenHarness is a Python CLI (`oh` / `openharness`), not an HTTP server. The PHP bridge must not invoke it inside a cPanel request. A separately hosted worker must implement this contract before the Declarafy feature flag can be enabled.

## Endpoint

```http
POST /v1/jobs
Authorization: Bearer <service-token>
Content-Type: application/json
```

Request body (strict JSON object; reject unknown top-level keys):

```json
{
  "task": "tax_question",
  "input": { "question": "string, max 8000 characters" },
  "request_id": "32 lowercase hex characters",
  "user_ref": "opaque internal reference"
}
```

Allowed task names and exact input schemas:

| Task | Required input | Limits |
|---|---|---|
| `tax_question` | `{"question":"..."}` | Non-empty string, max 8,000 bytes |
| `document_summary` | `{"text":"..."}` | Non-empty string, max 40,000 bytes |
| `tax_data_analysis` | `{"data":[...]}` | JSON array with 1–500 items; total encoded input max 50,000 bytes |

Reject unknown keys within each task input. The worker must independently repeat these validations; it must not trust the PHP bridge alone. It must reject arbitrary command strings, file paths, URLs, tool definitions, model/provider overrides, and extra keys. For document summarization, the client sends document text, not a server-side path. For data analysis, the client sends structured JSON rows, not a server path.

## Query job status (prototype)

```http
GET /v1/jobs/{job_id}
X-User-Ref: <opaque-internal-reference>
Authorization: Bearer <service-token>
```

The prototype returns only `job_id`, `task`, `status`, and `created_at`. It requires service authentication and matches the supplied opaque `user_ref` against the stored owner. Unknown jobs and jobs owned by another user both return 404. It never returns the stored input or result. Since execution is disabled, newly accepted jobs remain `queued`; this endpoint is not evidence that an agent has run.

## Idempotency and safe retries

The PHP bridge accepts an optional `Idempotency-Key` HTTP header containing exactly 32 lowercase hexadecimal characters. A client must generate this key once per logical submission and reuse the same key when retrying that submission after a timeout or lost response. The bridge forwards it unchanged as `request_id`. If the header is omitted, the bridge generates a fresh request ID; retries without a client-supplied key are therefore **not** guaranteed to deduplicate.

The worker must continue binding a request ID to the authenticated owner, task type, and canonical payload. Reusing the same key with a different owner, task, or payload must return 409 and must never create a second job. Clients must not reuse keys for distinct submissions. Keep the key until the client has received a definitive receipt or has reconciled the job status.

## Accepted response

Return HTTP 202 only after a durable job record is created:

```json
{"job_id":"opaque-random-id"}
```

Return 400 for invalid schema, 401/403 for invalid service authentication, 413 for oversized input, and 429 when queue/concurrency limits are reached. Never return tracebacks, provider responses, prompt internals, environment variables, or logs.

## Execution and containment requirements

1. Authenticate the service token using constant-time comparison and rotate it periodically.
2. Create a random per-job directory with restrictive permissions; destroy it after retention expires.
3. Run the agent as a non-root OS user in a disposable container with read-only root filesystem, no host mounts, no production credentials, no Docker socket, and no direct access to the Declarafy database.
4. Disable shell, MCP, browser, remote-control channels, and arbitrary filesystem tools unless a reviewed task explicitly requires them. Enforce workspace containment in the actual tool implementation, including symlink and traversal cases.
5. Use provider credentials from worker environment/secret storage only. Never put secrets in command-line arguments, task input, output, or logs.
6. Set a hard execution deadline, maximum output size, concurrency cap, and per-job token/cost budget. Queue overflow must fail closed.
7. Persist task status/results separately; validate and sanitize output before Declarafy can retrieve it. A job receipt alone does not mean the task completed.
8. Log only request ID, job ID, timing, status, and sanitized error category. Do not log tax documents or raw prompts.

## Integration gate

Do not set `DECLARAFY_OPENHARNESS_ENABLED=1` until a real worker implements this contract; authentication, queue, isolation, timeouts, output validation, and budget tests pass; a synthetic-data end-to-end test passes from Declarafy staging to worker and back; the OpenHarness permission/path traversal issues documented in `openharness-integration-plan.md` are resolved or mitigated with tests; and a reviewer confirms the exact tax workflows and allowed tools.

The CLI's JSON output option does not itself make it a safe tax API. OpenHarness is a general-purpose coding agent; task-specific restrictions must be enforced outside the model.


## Queue lifecycle and worker lease protocol (prototype)

The worker now supports an authenticated internal pull protocol:

- `POST /internal/worker/claim` atomically claims the oldest eligible queued job and returns its task envelope plus a random lease token. The endpoint is service-token protected and is intended only for the isolated worker process.
- `POST /internal/worker/{job_id}/complete` accepts exactly `lease_token` and `result`. Results are bounded to 50,000 UTF-8 bytes and JSON non-finite values are rejected.
- `POST /internal/worker/{job_id}/fail` accepts exactly `lease_token` and a sanitized error code. Failed attempts are requeued with bounded exponential backoff until the configured attempt cap (3), then become terminal `failed`.
- A claim lease lasts 120 seconds. A later claim recovers expired `running` jobs: it requeues them if attempts remain, otherwise marks them `failed` with `lease_expired`. A stale lease token cannot complete or fail a newer attempt.
- Owner-scoped `GET /v1/jobs/{job_id}` reports `queued`, `running`, `completed`, or `failed`, plus attempt count, update time, and sanitized error code. It does not expose payloads, lease tokens, or result bodies.

The queue schema is migrated forward when the worker opens its SQLite database. The protocol is still not a deployed always-on consumer: no OpenHarness execution is started automatically. The PHP result-fetch route is now wired to the internal owner-scoped worker result endpoint, but the full path has not yet been verified against a staging worker host. Do not enable live submissions or treat a completed synthetic result as tax advice. The queue includes 30-day terminal retention, lease renewal, owner-scoped cancellation, and AES-256-GCM encryption for new payload/result fields with an explicit backup-first legacy migration and key-rotation utility. Operational key management, verified backup/WAL cleanup, real process cancellation, and staging end-to-end verification remain release gates. Terminal `completed`, `failed`, and `cancelled` records are eligible for deletion after 30 days; queued/running records are never pruned.

The PHP bridge exposes an authenticated, owner-scoped status lookup via `GET api/openharness.php?job_id=<job_id>` and result retrieval via `GET api/openharness.php?job_id=<job_id>&result=1`. Both derive `X-User-Ref` from the server-side Declarafy session and never accept an owner reference from the browser. Status returns lifecycle metadata only; result retrieval returns the completed JSON result with `Cache-Control: no-store`.


## Retention policy

The trusted maintenance process deletes terminal `completed`, `failed`, and `cancelled` records after 30 days based on `updated_at`. Queued and running records are never deleted by retention. SQLite secure-delete and WAL truncation are best-effort storage hygiene, not cryptographic erasure or a guarantee about external backups/snapshots.

## Lease renewal and cancellation (prototype)

- A live worker may call `POST /internal/worker/{job_id}/renew` with exactly `{"lease_token":"..."}`. Renewal extends the lease by 120 seconds from the server clock. Expired, cancelled, or superseded leases return 409.
- The authenticated PHP bridge may submit `POST api/openharness.php` with `{"action":"cancel","job_id":"..."}`. The bridge derives the owner from the Declarafy session and forwards it to `POST /internal/jobs/{job_id}/cancel`; the browser cannot choose the owner reference.
- Only `queued` and `running` jobs can be cancelled. Cancellation atomically sets `cancelled` and clears the lease token hash and expiry. A worker holding the previous token can neither renew nor complete/fail the cancelled job. Repeated cancellation is idempotent; terminal completed/failed jobs return 409; foreign/unknown jobs return 404.
- Cancellation is cooperative: it fences off queue state and prevents stale results from being committed, but it does not yet terminate an already-running OS process. A future executor must poll cancellation or receive a separately isolated process-termination signal.


## Completed result retrieval

- Internal worker route: `GET /internal/jobs/{job_id}/result`.
- Requires the service Bearer token and `X-User-Ref`; the worker verifies both the job ID and owner reference.
- Returns a result only when the job is `completed`; queued/running/failed/cancelled jobs return a not-ready conflict, and unknown/foreign jobs return the same 404.
- The worker decrypts the stored result only after the owner check. It never exposes ciphertext or result data from the public status route.
- The PHP bridge exposes owner-checked retrieval through the authenticated session using `GET /api/openharness.php?job_id=...&result=1`. It derives `X-User-Ref` from the server-side session, validates the worker response, caps response buffering at 64 KiB, and returns `Cache-Control: no-store`.
- This is an API retrieval primitive only. The product UI still needs a reviewed presentation/polling workflow before end users can consume completed agent output.
