# OpenHarness executor security design decision

Status: design only — execution MUST remain disabled.

## Why the default CLI/runtime is not an acceptable worker boundary

The upstream OpenHarness package is a full agent harness, not a narrow tax-question API. Its default tool registry includes Bash, file write/edit, notebook editing, MCP authentication and MCP tools, web fetch/search, image generation, cron scheduling, remote triggers, task management, and multi-agent/team tools. The normal runtime also loads plugins, MCP server configurations, hooks, project skills, and user settings.

Do not call the general-purpose `oh` CLI from a PHP request, do not mount a Declarafy application directory into an agent, and do not expose the default tool registry to taxpayer prompts. A default installation could give an agent far more authority than a tax-advisory task requires.

Upstream references reviewed on 2026-10-30 (repository main resolved to commit `9b2efd795c6aa09f88b0c257d269a9e518da6ae7`; package metadata declares `openharness-ai` 0.1.9):
- Package metadata and dependencies: https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/pyproject.toml
- Default tool registry: https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/tools/__init__.py
- Runtime assembly: https://github.com/HKUDS/OpenHarness/blob/9b2efd795c6aa09f88b0c257d269a9e518da6ae7/src/openharness/ui/runtime.py

The upstream source review is not a dependency pin or a production approval. The integration must choose and independently review a released version/commit before adding it to the worker image.

## Required integration shape

1. Run a separate worker process/container. PHP submits only a typed task envelope and opaque owner reference; it never starts a shell command or supplies a runtime configuration.
2. Pin an exact reviewed OpenHarness release and dependency lock. Do not install from a floating `main` branch or use an unpinned package range.
3. Use OpenHarness Python APIs only after an adapter has been written against that exact release. Do not invoke the interactive CLI or inherit a developer's home directory, provider profile, auth files, MCP config, plugins, hooks, or project skills.
4. Construct a new, explicit allow-list tool registry for Declarafy task classes. Start with no tools. Add only read-only, task-specific tools after each has a separate threat model and tests. Never enable Bash, arbitrary file writes/edits, MCP, remote triggers, cron, generic browser, arbitrary URL fetch, image generation, or agent/team spawning for tax tasks by default.
5. Put each job in a fresh, disposable workspace with a generated directory name. Enforce path canonicalization, no symlink traversal, read-only source inputs, bounded scratch space, and cleanup even on timeout/cancellation.
6. Run the agent under a dedicated non-root UID in a separate sandbox/container with read-only root, dropped capabilities, seccomp/AppArmor, no Docker socket, no host mounts, no application credentials, and no network by default. If a provider API is needed, permit only the exact provider hostname through a controlled egress proxy.
7. Enforce hard wall-clock deadline, CPU/memory/process/disk ceilings, queue depth, per-user concurrency, per-job token and monetary budgets, maximum model turns, maximum output size, and cancellation that kills the process group/container.
8. Treat model output as untrusted. Validate it against a task-specific JSON schema; do not execute generated SQL, code, shell, browser actions, SUNAT submissions, payments, or legal/tax decisions. Require deterministic checks and explicit human approval for any consequential action.
9. Store only encrypted bounded inputs/outputs. Keep provider credentials separate from the worker service token and encryption keyring. Redact all prompts, documents, tax identifiers, and provider responses from logs.
10. Verify the complete PHP → private ingress → worker → OpenHarness → encrypted result → PHP owner session path in staging with synthetic data, then obtain independent security review before considering activation.

## Initial task profiles

| Task | Permitted capabilities (initial proposal) | Explicitly forbidden |
|---|---|---|
| `tax_question` | Model reasoning over the user-supplied question and approved static tax reference snippets | Shell, filesystem, web, MCP, agent delegation, filings, payments |
| `document_summary` | Read-only access to the single uploaded document via a narrowly scoped in-memory adapter | General filesystem, arbitrary paths, network, shell, external tools |
| `tax_data_analysis` | Deterministic parser/calculation functions over a bounded uploaded dataset; model may explain validated aggregates | Arbitrary code execution, SQL execution, unrestricted spreadsheet macros, external data exfiltration |

These profiles are a design proposal, not implemented capabilities. Do not mark any task executable until the exact allow-list and adapter are implemented and tested.

## Release gates

- [ ] Pin an exact upstream OpenHarness release and produce a reproducible dependency lock/SBOM.
- [ ] Build a minimal custom registry; automated test asserts forbidden tools are absent.
- [ ] Build the adapter with no inherited home/config/plugins/MCP/hooks.
- [ ] Build per-job sandbox/workspace and adversarial path tests.
- [ ] Enforce and test egress denial by default and provider-only egress when approved.
- [ ] Enforce hard resource, deadline, budget, concurrency, and output limits.
- [ ] Prove process/container termination on cancellation and timeout.
- [ ] Test schema validation, hostile prompt injection, malicious documents, and cross-job isolation.
- [ ] Complete synthetic-data staging E2E and independent security review.

Until every gate is met, the worker must continue to queue/track jobs only; execution stays disabled and the PHP feature flag stays OFF.
