# Declarafy OpenHarness runtime adapter

Status: integration spike; no production execution is authorized.

## Upstream version

- Distribution: `openharness-ai==0.1.9`
- Upstream repository: https://github.com/HKUDS/OpenHarness
- Upstream tag: `v0.1.9`
- Tag target commit: `a0f8552c69d6d0b25d613af288823212a8b6b59a`
- The upstream tag object is unsigned. The version pin is not a cryptographic provenance guarantee.
- Upstream `pyproject.toml` declares broad lower-bound dependencies. A complete transitive dependency lock and SBOM remain a release blocker; do not treat this direct pin as a reproducible supply-chain lock.

## Why Declarafy does not use the normal runtime builder

OpenHarness `build_runtime()` assembles default tools, plugin discovery, MCP connections, hooks, settings, skills, project memory, and optional sandbox state. That is intentionally not called by Declarafy. The default tool registry includes shell, file write/edit, MCP, web, cron, remote trigger, and agent/team tools.

Instead, `worker/openharness_runtime.py` constructs the upstream `QueryEngine` directly with:
- A newly constructed, empty `ToolRegistry`.
- No plugin, skill, hook, MCP, or default runtime initialization.
- Permission mode `PLAN`, explicit empty allow-list, and deny-all tool/command patterns.
- One model turn, 2,048 completion tokens, 45-second wall-clock timeout, and 20 KB maximum output.
- A per-job temporary working directory, removed after execution.
- A server-side provider key file with strict regular-file and permission checks.
- A task-specific system instruction. User documents are explicitly treated as untrusted content.

Supported task envelopes are limited to the worker's existing validated task types: `tax_question`, `document_summary`, and `tax_data_analysis`. The runtime returns text plus model/token metadata; it does not submit SUNAT filings, execute calculations/code, access arbitrary files, browse, or call external tools.

## Execution gate

The runtime refuses to execute unless `OPENHARNESS_EXECUTION_ENABLED=1` is explicitly present. The worker's existing API feature flag remains OFF. Provider configuration is server-side only:
- `OPENHARNESS_ANTHROPIC_API_KEY_FILE`: path to a protected key file (never a literal key in Compose or Git).
- `OPENHARNESS_MODEL`: approved model identifier.
- `OPENHARNESS_ANTHROPIC_BASE_URL`: optional operator-controlled compatible endpoint; never supplied by a job.

Do not set the execution flag on a real host yet. The current Compose worker network has no outbound provider access, and no executor daemon, live cancellation, spend budget, concurrency quota, egress proxy, or end-user result UI has been accepted.

## Required next gates

1. Generate and review a full transitive lock/SBOM; verify package hashes and dependency licenses.
2. Add an executor process that claims jobs and invokes this adapter, with a hard stop on cancellation, lease expiry, timeout, and per-user budget.
3. Add controlled provider-only egress; default deny remains mandatory.
4. Add synthetic integration tests for queue → runtime → encrypted result and cross-job isolation.
5. Independently review prompt injection, provider data handling, output validation, resource controls, and secret handling.
6. Only then consider a separately approved staging activation. Production remains disabled.
