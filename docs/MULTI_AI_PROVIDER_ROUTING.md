# Declarafy — multi-IA provider routing (PR #40)

## Purpose
Prepare a safe, low-cost path for Declarafy to use more than one AI provider without making the web app depend on a provider SDK or exposing API keys to the browser.

## Scope of this PR
This is a rollout/contract document, not a claim that multiple live providers are already connected. It defines the implementation boundary for the next code change.

## Target design
- Keep provider calls server-side in PHP; never send provider credentials to the browser.
- Use an explicit allowlist of provider IDs and model IDs configured by environment/private config.
- Route by task (tax_advice, file_processing, orchestration) to a configured provider/model. Do not let model output choose arbitrary URLs, tools, or provider IDs.
- Default to one configured provider. If a provider is missing, disabled, times out, or returns malformed data, return a sanitized error; do not silently claim another AI answered.
- Add a per-request timeout, response-size cap, input-size cap, and bounded retry policy (default zero retries).
- Enforce authentication, CSRF, rate limits, and existing plan/quota checks before provider execution.
- Never log prompts, tax documents, tokens, API keys, or full provider responses. Log only request ID, provider ID, latency, status category, and token/cost metadata when reliably available.
- Treat uploaded files, retrieved pages, and model output as untrusted. No agent may execute arbitrary code, SQL, shell commands, or unrestricted network requests.
- Multi-agent workflows must be deterministic, bounded, and task-allowlisted. The coordinator must validate tool name, schema, and arguments server-side; tools perform the actual calculations/actions.
- Avoid installing OpenHarness/Python runtime on Namecheap/cPanel. Start with a small PHP orchestration layer compatible with the existing hosting; evaluate an external runtime only if a later isolated test proves it is required.

## First task routes
1. Tax adviser — grounded answers with source/effective-date warnings; must not invent legal citations.
2. File processing — extraction/normalization of user-provided files with strict size/type limits and a preview-before-import workflow.
3. Multi-agent coordinator — bounded planning and specialist roles; roles are metadata unless each role is explicitly wired to a real provider call.

## Acceptance criteria for the implementation PR
- Unit tests for provider allowlisting, missing configuration, malformed responses, timeout/error sanitization, and quota enforcement.
- Fake-provider tests that do not call external AI services or incur costs.
- No provider key in frontend files or API responses.
- One provider request maximum per normal task by default; any multi-call workflow has an explicit hard cap and documented cost/latency.
- Existing login, SUNAT, file import, and dashboard tests remain green.
- Feature flag off by default; no automatic production enablement or deployment.
- A real provider smoke test is a separate, explicitly authorized step using configured test credentials.

## Important status
This document does not itself connect any AI provider and does not change production. A code implementation must be reviewed and tested before merging. Keep all provider credentials in private server configuration or environment variables, never in Git.