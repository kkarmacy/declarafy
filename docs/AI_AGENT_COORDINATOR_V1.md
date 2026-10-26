# Declarafy AI Agent Coordinator (prototype)

Status: isolated prototype on `feat/ai-agent-coordinator-v1`. Not deployed and not connected to live AI providers.

## What is implemented
- Fixed allowlist of logical roles: tax, documents, calculator, verifier, report.
- Bounded workflow planning (maximum three steps).
- Input and output size validation.
- Feature flag `DECLARAFY_AI_AGENTS_ENABLED`, disabled by default.
- Standalone PHP test file using synthetic examples.

## Compatibility
Designed as plain PHP for the existing PHP 8.3 + MySQL/MariaDB + Namecheap/cPanel stack. This prototype does not require Python, a database migration, a new service, or new paid dependencies.

## Test
Run in an environment with PHP CLI and mbstring:
```sh
php tests/php/agent-coordinator.test.php
php -l api/ai/AgentCoordinator.php
```

## Important limitations
This is the first implementation slice, not a complete multi-agent product. It does not call an LLM, retrieve official SUNAT sources, read uploaded documents, authenticate requests, enforce plan quotas, or expose an HTTP endpoint. Do not enable the feature flag in production yet. Those pieces require integration with the existing authenticated API and tests for user/tenant isolation, CSRF, provider timeouts, rate limits, prompt injection, source citations, and cost controls.

## Next implementation steps
1. Inspect the existing AI endpoint and its authentication, plan limits, CSRF, and provider selection.
2. Wire this coordinator behind those existing checks; do not create a parallel authentication path.
3. Add one provider adapter reusing an already configured key, with timeout and response-size limits.
4. Add retrieval only from an approved corpus of official sources with publication/effective dates.
5. Add deterministic calculation tools and source/consistency validation.
6. Run PHP lint, unit tests, `npm test`, and synthetic E2E/security tests.
7. Review the PR before merging; production deployment remains a separate explicit step.
