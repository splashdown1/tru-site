# TRU online LLM gateway

The online TRU gateway keeps provider keys on the server. Browser clients never receive an upstream API key.

## Secrets

Set these in the service environment, not in committed files:

- `LLM_GATEWAY_API_KEY` — bearer token accepted by TRU clients.
- `OPENAI_API_KEYS` — comma- or newline-separated upstream keys. This is the preferred pool variable.
- `OPENAI_API_KEY_1`, `OPENAI_API_KEY_2`, etc. — alternative numbered pool variables.
- `OPENAI_BASE_URL` — optional OpenAI-compatible `/v1/chat/completions` endpoint; defaults to OpenAI.
- `OPENAI_MODEL` — optional default model; defaults to `gpt-4o-mini`.
- `LLM_KEY_COOLDOWN_MS` — fallback cooldown when an upstream 429 has no `Retry-After`; defaults to 60 seconds.
- `LLM_MAX_KEY_ATTEMPTS` — optional per-request cap. `0` means try every available key once.

## Routes

- `POST /api/llm/chat` — compact gateway endpoint.
- `POST /api/llm/v1/chat/completions` — OpenAI-compatible endpoint.
- `GET /api/llm/status` — authenticated pool status; never returns key values.

The gateway uses process-wide round-robin selection. Each request starts at the next key, skips keys still cooling down, and retries the same request on the next pool member after HTTP 429. When every key is exhausted, it returns HTTP 429 with `Retry-After`; it does not spin or retry indefinitely.

Clients should send `Authorization: Bearer <LLM_GATEWAY_API_KEY>` to the gateway. Client-side routing should select between gateway URLs if multiple gateway instances are deployed; it must never contain provider keys.
