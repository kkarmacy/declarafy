# Declarafy AI Agent Coordinator (prototype)

**Status:** prototype on `feat/ai-agent-coordinator-v1`. Changes are in pull request #38 and are not deployed. Coordinator mode is disabled by default.

## Implemented

- Fixed logical roles: tax, documents, calculator, verifier and report.
- Bounded workflow planning (maximum three steps), with verifier retained for combined document/calculation workflows.
- Coordinator prompt and one allowlisted `calculate_tax_amount` tool, enabled only when `DECLARAFY_AI_AGENTS_ENABLED=true`. Tool execution happens in PHP, never as model-supplied code. A tool-using turn may require an additional Anthropic request, increasing latency and provider cost.
- Deterministic tax arithmetic helper in `api/ai/TaxCalculator.php`. It calculates using a supplied rate; it does not decide which rate is legally applicable.
- Allowlisted official SUNAT source retrieval in `api/ai/SunatSourceRegistry.php`, limited to two fixed HTTPS pages on `orientacion.sunat.gob.pe`. Redirects are refused, TLS is verified, time and response size are bounded, and extracted text is capped. The response includes the canonical URL, UTC retrieval timestamp and SHA-256 of the response body.
- Authenticated, rate-limited endpoint: `GET api/index.php?action=sunat_source&id=igv_rate` or `id=igv_calculation`.
- When coordinator mode is enabled, IGV-related questions trigger bounded retrieval of the registered `igv_rate` page. The retrieved text and provenance are added to provider context as **untrusted evidence**, not instructions. If retrieval fails, the prompt tells the model not to claim the rate or its effective period was verified.
- Tests use an injected source transport and do not make live network requests.
- Static regression tests verify that the AI, tax-calculation and SUNAT-source routes retain method checks, authentication, rate limits and safe failure handling.

## Compatibility

Designed for the existing PHP 8.3 + MySQL/MariaDB + Namecheap/cPanel stack. No Python runtime, database migration, separate service or new paid dependency is required by this prototype.

## Tax calculation limitations

The authenticated `POST api/index.php?action=tax_calculate` endpoint accepts numeric `amount` and `rate_percent`, plus optional boolean `tax_included`. The caller must provide a rate verified for the transaction and date. In the chat tool path, the backend requires exactly one distinct percentage in the latest user message and rejects multiple rates and obvious negation/correction language. This is a conservative ambiguity guard, not legal validation or full natural-language interpretation.

## Source retrieval limitations

Retrieving a page does **not** establish that a rule applies to a particular taxpayer, transaction or tax period. The registry currently covers only two SUNAT pages, does not archive snapshots in persistent storage, does not parse or validate publication/effective dates, and does not resolve conflicting guidance. HTML is reduced to bounded text, but the retrieved content remains untrusted and must never override system/developer instructions. A retrieval timestamp and hash provide provenance, not proof of legal applicability or correctness.

No live SUNAT fetch or production behavior has been verified by the automated tests; source tests use a controlled injected transport. Coordinator mode remains off by default.

## Tests

The GitHub Actions workflows run PHP syntax/unit checks, security checks and browser/integration tests on pull request updates. Relevant local checks include:

```sh
php -l api/ai/AgentCoordinator.php
php -l api/ai/TaxCalculator.php
php -l api/ai/SunatSourceRegistry.php
php tests/php/agent-coordinator.test.php
php tests/php/tax-calculator.test.php
php tests/php/sunat-source-registry.test.php
npm test
```

## Next steps

1. Add explicit tests for prompt-injection-like text in retrieved source content and ensure it remains data, not instructions.
2. Add dynamic endpoint-level tests for authentication, rate limiting, and source retrieval failures; current regression coverage checks these guards statically.
3. Design caching/retention, effective-period checks and conflicting-source handling before relying on retrieved rates in user-facing answers.
4. Run full CI and review the pull request.
5. Merge and production deployment are separate steps and require explicit approval.
