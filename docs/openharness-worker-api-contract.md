# OpenHarness worker API contract (v1)

Status: design contract only. No worker endpoint is deployed by this repository yet.

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

Allowed task names: `tax_question`, `document_summary`, `tax_data_analysis`.

The worker must validate a different schema per task. It must reject arbitrary command strings, file paths, URLs, tool definitions, model/provider overrides, and extra keys. File-based tasks must upload content into a newly created per-job workspace; never accept a server path from the client.

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