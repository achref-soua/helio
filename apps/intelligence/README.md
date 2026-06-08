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

## Copilot surface

The dashboard is the only HTTP caller: it authenticates the user and
forwards the _verified_ organization/workspace, which the service enforces
via Postgres RLS. Generators return a draft; saving goes through the normal
TypeScript APIs, which re-validate against the canonical schemas.

| Endpoint                   | Does                                                              |
| -------------------------- | ----------------------------------------------------------------- |
| `POST /v1/copilot/chat`    | Agentic, tool-using Q&A grounded in the workspace's own data      |
| `POST /v1/copilot/segment` | NL → a validated segment rule                                     |
| `POST /v1/copilot/journey` | NL → a journey wired to the workspace's real templates            |
| `POST /v1/copilot/email`   | NL → an on-brand email (subject + blocks), grounded in past sends |

Each returns `503` until `INTEL_LLM_API_KEY` and `INTEL_DATABASE_URL` are
set, and `422` when the model can't produce a valid result — so the
dashboard degrades gracefully when the AI plane is offline.

The **MCP server** (`uv run python -m helio_intelligence.mcp_server`)
exposes the same capabilities as tools for external agents:
`workspace_summary`, `search_contacts`, `list_segments`/`list_journeys`/
`list_campaigns`/`list_email_templates`, and `draft_segment`/
`draft_journey`/`draft_email` — all scoped to the one workspace named by
`INTEL_MCP_ORGANIZATION_ID`/`INTEL_MCP_WORKSPACE_ID`.

## Predictive scoring

`POST /v1/scoring/recompute` trains and writes two probabilities per
contact, scoped to one workspace:

- **conversion propensity** — a gradient-boosted classifier
  (`HistGradientBoostingClassifier`) over behavioral features (event
  counts, recency, opens/clicks, tenure, rule score). The positive label
  is a configured conversion event (`INTEL_SCORING_CONVERSION_EVENTS`).
- **churn risk** — a second boosted model trained on a leakage-safe label
  (no activity in the last 30 days, among contacts old enough to judge),
  deliberately excluding the recency/short-window features that define it.

Behavioral features come from ClickHouse; predictions are written back to
Postgres (`contact.conversion_probability` / `churn_risk`) inside an
RLS-scoped transaction, so a run can only ever touch its own organization.
When a workspace has too little labeled data to train, the model falls
back to a transparent monotonic engagement heuristic, and the response
reports which path ran (`conversion_method` / `churn_method`) so the UI
stays honest. The dashboard triggers a recompute from the Contacts page;
a scheduler can hit the same endpoint nightly.

## Develop

```bash
cd apps/intelligence
uv sync
uv run uvicorn helio_intelligence.app:app --reload   # :8000
uv run ruff check . && uv run mypy && uv run pytest    # the local gate
```

`GET /v1/llm/config` reports the active provider/model and whether a key
is configured — without ever echoing the key.
