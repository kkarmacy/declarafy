# LiteLLM gateway for Declarafy

Declarafy calls LiteLLM only from the PHP backend. Never expose provider keys, the LiteLLM master key, or the Declarafy virtual key in browser JavaScript.

## Required server variables

Set these outside `public_html` / source control:

- `LITELLM_BASE_URL=https://ai.declarafy.com`
- `LITELLM_API_KEY=<virtual key dedicated to Declarafy>`
- `LITELLM_MODEL=declarafy-tax`

The gateway should be deployed on a separate VPS/container host. Use PostgreSQL if virtual keys, budgets and spend tracking are required.

## Gateway model alias

Create a LiteLLM model/alias named `declarafy-tax`. Start with one provider and add fallbacks only after each provider is tested. Keep provider credentials in LiteLLM, not Declarafy.

## Smoke test

POST JSON to `/api/ai/chat.php`:

```json
{"message":"Explica qué es el IGV en términos generales."}
```

A configured gateway should return JSON with `answer` and `model`. Until the three environment variables exist, the endpoint deliberately returns HTTP 503 instead of leaking or hard-coding credentials.

## Tax accuracy

The gateway is an inference layer, not a source of truth. Current SUNAT/normative retrieval and deterministic tax calculations should be added as verified context before relying on the endpoint for case-specific tax answers.
