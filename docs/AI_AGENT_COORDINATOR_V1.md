# Declarafy AI Agent Coordinator (prototype)

Status: prototype on `feat/ai-agent-coordinator-v1`. Wired into the existing authenticated Anthropic `ai` route behind a disabled-by-default feature flag. Not deployed.

## What is implemented
- Fixed allowlist of logical roles: tax, documents, calculator, verifier, report.
- Bounded workflow planning (maximum three steps).
- Input size checks for coordinator planning and a standalone response-length validator.
- Feature flag `DECLARAFY_AI_AGENTS_ENABLED`, disabled by default.
- Deterministic arithmetic helper in `api/ai/TaxCalculator.php` for calculating a tax amount from an explicitly supplied rate, including tax-exclusive and tax-inclusive amounts.
- Standalone PHP tests for coordinator routing, calculator rounding/validation, and explicit user-provided rate provenance.
- Optional coordinator prompt and one allowlisted `calculate_tax_amount` tool are enabled only when `DECLARAFY_AI_AGENTS_ENABLED=true`; the tool is executed in PHP, not as model-provided code. A tool-using chat turn can require one additional Anthropic request, increasing latency and provider cost.

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
This is a first integration slice, not a full multi-agent product. It still uses one existing Anthropic model call; the selected roles are planning guidance, not independently executing agents. The arithmetic helper is exposed through an authenticated `POST api/index.php?action=tax_calculate` endpoint. The request body requires numeric `amount` and `rate_percent`, plus optional boolean `tax_included`; the endpoint enforces session authentication and rate limits. It returns the calculation and a disclaimer. It deliberately does not decide which tax rate applies: callers must supply a rate verified for the relevant transaction and date. In the chat tool path, the backend requires exactly one distinct percentage in the latest user message and rejects multiple rates plus obvious negation/correction language. This is a conservative ambiguity guard, not legal validation or full natural-language interpretation. It does not retrieve official SUNAT sources or read uploaded documents. The feature flag remains off by default. Before enabling it, add security tests for prompt injection, source citations, model output, and production behavior.

## Next implementation steps
1. Add endpoint-level integration tests against a controlled PHP test harness and run the full CI suite on the latest commit.
2. Add approved official-source retrieval with publication/effective dates and citations.
3. Add separately executing agents only if latency, provider cost, and quality tests justify multiple calls.
4. Add source/consistency validation and prompt-injection tests.
5. Run PHP lint, unit tests, `npm test`, and synthetic E2E/security tests.
6. Review the PR before merging; production deployment remains a separate explicit step.


## Official-source policy (preparatory, not yet automated)

The coordinator prompt now distinguishes a source that is merely known from a source actually supplied or retrieved for the current answer. It must not claim it checked a source unless the source content or URL was actually available, and it must not invent URLs, quotations, legal provisions, or citations.

Initial official reference pages identified for future source integration:
- SUNAT, IGV rate and taxable operations: https://orientacion.sunat.gob.pe/3053-concepto-tasa-y-operaciones-gravadas-igv-empresas
- SUNAT, calculation of IGV: https://orientacion.sunat.gob.pe/3109-05-calculo-del-impuesto
- SUNAT, taxpayer-facing IGV overview: https://emprender.sunat.gob.pe/principales-impuestos/impuesto-general-las-ventas-igv/impuesto-general-las-ventas

These URLs are candidate references, not a live retrieval service. The current application does not fetch, archive, parse, or verify their content or effective dates. A production implementation still needs a controlled source registry/retrieval layer, timestamps, applicability/effective-period metadata, and tests that fail closed when sources are unavailable or conflicting.
