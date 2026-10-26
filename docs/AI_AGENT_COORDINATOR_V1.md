# Declarafy AI Agent Coordinator (prototype)

Status: prototype on `feat/ai-agent-coordinator-v1`. Wired into the existing authenticated Anthropic `ai` route behind a disabled-by-default feature flag. Not deployed.

## What is implemented
- Fixed allowlist of logical roles: tax, documents, calculator, verifier, report.
- Bounded workflow planning (maximum three steps).
- Input and output size validation.
- Feature flag `DECLARAFY_AI_AGENTS_ENABLED`, disabled by default.
- Standalone PHP test file using synthetic examples.
- Optional coordinator prompt is appended to the existing Anthropic request only when `DECLARAFY_AI_AGENTS_ENABLED=true`; it reuses current authentication, rate limiting, quota reservation and provider key, and makes no additional provider calls.

## Compatibility
Designed as plain PHP for the existing PHP 8.3 + MySQL/MariaDB + Namecheap/cPanel stack. This prototype does not require Python, a database migration, a new service, or new paid dependencies.

## Test
Run in an environment with PHP CLI and mbstring:
```sh
php tests/php/agent-coordinator.test.php
php -l api/ai/AgentCoordinator.php
```

## Important limitations
This is a first integration slice, not a full multi-agent product. It still uses one existing Anthropic model call; the selected roles are planning guidance, not independently executing agents. It does not retrieve official SUNAT sources or read uploaded documents. The feature flag remains off by default. Before enabling it, verify PHP lint/unit tests and add security tests for prompt injection, source citations, model output, and production behavior.

## Next implementation steps
1. Run PHP lint and standalone unit tests against this branch.
2. Add a deterministic calculator and an approved official-source retrieval layer.
3. Add separately executing agents only if latency, provider cost, and quality tests justify multiple calls.
4. Add retrieval only from an approved corpus of official sources with publication/effective dates.
5. Add deterministic calculation tools and source/consistency validation.
6. Run PHP lint, unit tests, `npm test`, and synthetic E2E/security tests.
7. Review the PR before merging; production deployment remains a separate explicit step.
