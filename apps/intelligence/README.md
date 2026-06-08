# @helio/intelligence

Helio's intelligence plane (Python 3.12 · FastAPI · uv): the AI copilot,
predictive scoring, segment/journey compute, and the MCP server. Built on
a **provider-agnostic LLM gateway** so the same agent runs on hosted or
self-hosted models without code changes.

## LLM gateway

One interface (`helio_intelligence.llm.LLMProvider`) with unified tool
calling; the vendor is selected by configuration:

| `INTEL_LLM_PROVIDER` | Backend                                  | Key      | Endpoint              |
| -------------------- | ---------------------------------------- | -------- | --------------------- |
| `groq`               | Groq (Llama 3/3.3, …)                    | required | Groq API (https)      |
| `openai`             | OpenAI (GPT)                             | required | OpenAI API (https)    |
| `anthropic`          | Anthropic (Claude)                       | required | Anthropic API (https) |
| `ollama`             | self-hosted                              | optional | `localhost:11434/v1`  |
| `local`              | self-hosted (vLLM, LM Studio, llama.cpp) | optional | `INTEL_LLM_BASE_URL`  |

OpenAI, Groq, and every self-hosted server share the OpenAI-compatible
wire format, so they run through one provider; Anthropic has its own.

### Security & privacy (non-negotiable)

- **Keys are secrets.** `INTEL_LLM_API_KEY` is a `SecretStr` — it never
  appears in logs, reprs, or the `/v1/llm/config` response. Inject it via
  the environment or a secrets manager; never commit one.
- **No plaintext to remote.** Prompts are refused over `http://` to a
  non-local endpoint unless `INTEL_LLM_REQUIRE_TLS=false` (intended only
  for a trusted private network). `localhost`/`127.0.0.1` are exempt so
  self-hosted models work out of the box.
- **Data sovereignty.** Choose `ollama`/`local` to keep every prompt and
  every byte of your data on your own infrastructure.
- **Tenant isolation.** Copilot RAG only ever reads the caller's own
  organization (enforced at the data layer — see the copilot milestone).

## Develop

```bash
cd apps/intelligence
uv sync
uv run uvicorn helio_intelligence.app:app --reload   # :8000
uv run ruff check . && uv run mypy && uv run pytest    # the local gate
```

`GET /v1/llm/config` reports the active provider/model and whether a key
is configured — without ever echoing the key.
