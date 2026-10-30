# OpenHarness integration spike for Declarafy

## Goal
Evaluate a safe, reversible path to offer OpenHarness-backed agent workflows from Declarafy without changing the existing PHP 8.3/MySQL production path.

## Current architecture constraint
Declarafy is deployed on Namecheap/cPanel using PHP 8.3 and MySQL/MariaDB. OpenHarness is a Python package/CLI (Python >=3.10) with filesystem, shell, web, MCP, and multi-agent tools. Do not install or execute the agent inside the public PHP request process and do not expose a general-purpose shell/filesystem tool to website users.

## Recommended deployment shape
1. Keep Declarafy as the user-facing application and authorization boundary.
2. Run OpenHarness in a separate, isolated worker/service with a dedicated OS user and a disposable per-job workspace.
3. Expose only a narrow authenticated HTTPS API between Declarafy and the worker. The API accepts a predefined task type plus validated structured input; it must not accept arbitrary shell commands, arbitrary filesystem paths, or user-supplied tool definitions.
4. Use a queue or bounded job runner. Enforce a maximum number of concurrent jobs, per-user rate limits, request/output size limits, deadlines, and a per-job/provider budget.
5. Keep all provider credentials on the worker side, in secret storage/environment configuration; never return them to Declarafy or place them in URLs, logs, command-line arguments, or task output.
6. Persist job status and sanitized output in Declarafy only after authorization and schema validation. Do not let the agent access the production database directly.
7. Put the feature behind a server-side feature flag that defaults to OFF. Preserve the existing AI path as fallback until acceptance checks pass.

## Security gates before enabling the feature
- Deny-by-default permissions; explicit deny rules must take precedence over allow lists.
- Ensure the path inspected by the permission checker is exactly the path consumed by the tool.
- Contain read/write/edit/grep/glob operations to the job workspace, including absolute paths, traversal, and symlink escapes.
- Keep shell, browser/network, MCP, hooks, and remote channels disabled unless individually required and allow-listed.
- Run jobs without production credentials, without host mounts, without access to the Declarafy database, and with network egress restricted to explicitly required model endpoints.
- Add audit logging that excludes secrets and sensitive tax data.
- Add regression tests for each security boundary and fail deployment if any security test fails.

## Acceptance checklist
- [ ] Isolated worker can start, stop, and report health without affecting Declarafy.
- [ ] Authentication and authorization are enforced server-side.
- [ ] Path traversal and parameter-shadowing regression tests fail closed.
- [ ] Denied commands/tools remain denied even if allow-listed.
- [ ] Workspace isolation tests cover absolute paths, traversal, and symlinks.
- [ ] Parallelism and per-job spend limits are enforced.
- [ ] Provider keys are absent from process arguments, logs, browser responses, and stored task records.
- [ ] Existing Declarafy static tests and Playwright smoke tests pass.
- [ ] End-to-end test runs against staging with synthetic data only.
- [ ] Feature flag remains OFF until all checks pass.

## Known blockers from static source review
- The current main branch permission checker checks allowed_tools before custom path and command deny rules.
- The path resolver in src/openharness/engine/query.py selects the first non-empty file_path, path, or root field from raw tool input; reported issue #348 describes a mismatch between the path checked and the path the tool executes.
- Workspace-containment fixes are proposed in upstream PRs #328 and #333 but were observed as open/unmerged during this review.
- Parallel agent spend behavior has not been benchmarked; issue #365 reports shared provider keys, no concurrency cap, and potential repeated input-token costs.

## Decision
This branch is an integration plan/spike only, not a production integration. Do not enable or deploy the OpenHarness feature until the security gates and acceptance checklist are verified. This plan intentionally does not modify the production app, database, SUNAT integration, or existing AI flow.