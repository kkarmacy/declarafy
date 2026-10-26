# Declarafy AI Agent Coordinator (prototype)

Status: prototype on `feat/ai-agent-coordinator-v1`. Wired into the existing authenticated Anthropic `ai` route behind a disabled-by-default feature flag. Not deployed.

## What is implemented
- Fixed allowlist of logical roles: tax, documents, calculator, verifier, report.
- Bounded workflow planning (maximum three steps).
- Input size checks for coordinator planning and a standalone response-length validator.
- Feature flag `DECLARAFY_AI_AGENTS_ENABLED`, disabled by default.
- Deterministic arithmetic helper in `api/ai/TaxCalculator.php` for calculating a tax amount from an explicitly supplied rate, including tax-exclusive and tax-inclusive amounts.
- Standalone PHP tests for coordinator routing and calculator rounding/validation.
- Optional coordinator prompt is appended to the existing Anthropic request only when `DECLARAFY_AI_AGENTS_ENABLED=true`; it reuses current authentication, rate limiting, quota reservation and provider key, and makes no additional provider calls.

## Compatibility
Designed as plain PHP for the existing PHP 8.3 + MySQL/MariaDB + Namecheap/cPanel stack. This prototype does not require Python, a database migration, a new service, or new paid dependencies.

## Tests
Run in an environment with PHP CLI and mbstring:
```sh
php -l api/ai/AgentCoordinator.php
php -l api/ai/TaxCalculator.php
php tests/php/agent-coordinator.test.php
php tests/php/tax-calculator.test.php
```
The GitHub Actions workflow runs these syntax checks and unit tests automatically.

## Important limitations
This is a first integration slice, not a full multi-agent product. It still uses one existing Anthropic model call; the selected roles are planning guidance, not independently executing agents. The arithmetic helper is currently a standalone utility and is **not yet connected to the chat endpoint**. It deliberately does not decide which tax rate applies: callers must supply a rate verified for the relevant transaction and date. It does not retrieve official SUNAT sources or read uploaded documents. The feature flag remains off by default. Before enabling it, add security tests for prompt injection, source citations, model output, and production behavior.

## Next implementation steps
1. Connect the deterministic calculator to a controlled API/tool path with strict input schemas and tests.
2. Add approved official-source retrieval with publication/effective dates and citations.
3. Add separately executing agents only if latency, provider cost, and quality tests justify multiple calls.
4. Add source/consistency validation and prompt-injection tests.
5. Run PHP lint, unit tests, `npm test`, and synthetic E2E/security tests.
6. Review the PR before merging; production deployment remains a separate explicit step.
