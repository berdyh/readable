# Readable

Readable is a Next.js application that ingests arXiv papers, persists structured records in Postgres, indexes embeddings in Qdrant for hybrid retrieval, and serves summaries plus question answering. Concepts encountered during reading are tracked per user in `persona_concepts` and surfaced as a skills sidebar. The LLM layer routes across OpenAI / Anthropic / Gemini / OpenRouter with cooldowns + automatic fallback.

## Prerequisites

- Node.js 18.18+ (Next.js 16 requirement)
- [pnpm](https://pnpm.io) 9.x (the repository is configured with `packageManager: pnpm@9.12.0`)
- Docker (for the bundled Postgres + Qdrant compose stack) **or** managed equivalents
- Access to:
  - **At least one** LLM provider — OpenAI, Anthropic Claude, Google Gemini, or OpenRouter (free tier available). The router auto-detects whichever you've authenticated.
  - Embedding provider — OpenAI `text-embedding-3-small` (default) **or** OpenRouter (`nvidia/llama-nemotron-embed-vl-1b-v2:free`)
  - Postgres 14+ (paper/figure/reference store, persona concepts, interaction log)
  - Qdrant (vector index for paper-chunk embeddings)
  - arXiv and (optionally) Semantic Scholar APIs for metadata

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Start local stores (Postgres + Qdrant) using the bundled compose file:
   ```bash
   docker compose up -d
   ```
   This brings up Postgres on `localhost:5432` (user/db `readable`) and Qdrant on `localhost:6333`.
3. Create a local environment file:
   ```bash
   cp .env.local.example .env.local
   ```
4. Populate `.env.local`:
   - **Required**
     - `OPENAI_API_KEY` (used for both LLM calls and `text-embedding-3-small` embeddings)
     - `DATABASE_URL` (defaults to the docker compose stack: `postgresql://readable:readable@localhost:5432/readable`)
     - `QDRANT_URL` (defaults to `http://localhost:6333`)
   - **Recommended**
     - `SEMANTIC_SCHOLAR_KEY` for higher-quota citation enrichment (works without it on the public rate limit)
     - `ARXIV_CONTACT_EMAIL` per arXiv API guidelines
   - **Model + pipeline switches**
     - `OPENROUTER_QA_MODEL` / `OPENAI_SUMMARY_MODEL` per-task overrides
     - `ENABLE_OCR_FALLBACK`, `DEEPSEEK_OCR_URL` for image-only PDFs (text PDFs work without OCR)
     - `ARXIV_API_BASE_URL`, `AR5IV_BASE_URL` to point at proxies / mirrors
     - Timeouts such as `INGEST_*_TIMEOUT_MS` for long-running PDF work
5. Apply the Postgres schema (idempotent — also runs automatically on first request):
   ```bash
   pnpm db:migrate
   ```
6. **Optional but recommended**: run the interactive provider chooser. It detects which LLMs you've authenticated (CLI tokens + env keys), prompts you to pick a primary + fallback chain, and writes `LLM_PROVIDER` / `LLM_ALLOWED_PROVIDERS` into `.env.local`:
   ```bash
   pnpm setup
   ```

Environment values can point to managed services or local Docker containers.

## Run the app

Start the development server:

```bash
pnpm dev
```

Navigate to [http://localhost:3000](http://localhost:3000). The UI walks through ingesting a paper by arXiv ID, generating a reasoning-first summary, and asking follow-up questions.

Useful scripts:

- `pnpm build` -> production bundle
- `pnpm start` -> serve the built app
- `pnpm lint` / `pnpm lint:fix` -> ESLint
- `pnpm test` -> Vitest suite
- `pnpm db:migrate` -> apply the Postgres schema in `src/server/db/schema.ts`
- `pnpm test:stores` -> ping Postgres, ensure the schema is in place, ping Qdrant, and ensure the `paper_chunks` collection exists
- `pnpm setup` -> interactive provider chooser; detects CLIs + env keys, writes `LLM_PROVIDER` / `LLM_ALLOWED_PROVIDERS` into `.env.local`
- `pnpm embeddings:probe` -> ping the active embedding provider with one test string and print the returned vector dimension (useful when a remote model ignores the requested `dimensions` parameter)

## Data flow overview

1. **Ingest** - fetch arXiv metadata, prefer ar5iv HTML, fall back to PDF (PDF.js or OCR via DeepSeek) and GROBID. Parsed sections, figures, and references are upserted into Postgres; chunk embeddings are written to Qdrant.
2. **Summaries** - gather relevant paper sections from Postgres and prompt the configured LLM for structured JSON. The response includes a list of `concepts` that get upserted to `persona_concepts` for the user.
3. **Q&A** - run a hybrid retrieval (Qdrant vector search + Postgres `tsvector` full-text search fused via Reciprocal Rank Fusion) constrained to the selected paper, combine chunks/figures/citations, and answer with grounded citations.

See `docs/API_ANALYSIS.md` and `docs/API_TESTING.md` for API documentation and testing information.

## Working with personas & models

- The reader's **skills** (concepts encountered) are accumulated automatically: every Q&A and summary call asks the model for a short list of `concepts` and upserts them to `persona_concepts`. The right-rail `SkillsPanel` shows them as chips. Anonymous interactions (no `userId`) are not tracked.
- To switch LLMs, set `LLM_PROVIDER=openai|anthropic|gemini|openrouter` and (optionally) `LLM_ALLOWED_PROVIDERS=openrouter,openai,anthropic` for an OpenClaw-style fallback chain. See [Multi-provider routing](#multi-provider-routing).
- Per-task model overrides via env: `OPENAI_QA_MODEL`, `ANTHROPIC_PAPER_SUMMARY_MODEL`, `OPENROUTER_QA_MODEL`, etc.
- For self-hosted or Azure OpenAI deployments, configure `OPENAI_API_BASE_URL`, `OPENAI_ORGANIZATION`, and `OPENAI_PROJECT`.

## Three-Pass guided reading

The workspace ships an Adler-style three-pass UX (skim → read → deep). The pass-state is persisted per-paper in `localStorage` and surfaced as a soft guide — every pass shows its goal, four bullets, and a time budget. `usePassState` keys on `paperId` so each paper gets its own progress.

| Pass | Goal | Typical budget |
|---|---|---|
| Skim | Decide whether the paper is worth a deeper read | 5–10 min |
| Read | Grasp the content but skip proofs and edge cases | 30–60 min |
| Deep | Re-create the paper. Identify hidden assumptions | Several hours |

Soft-guide by design: any pass is reachable at any time; the bar nudges, it doesn't gate.

## Multi-provider routing

Pattern adapted from [OpenClaw](https://github.com/openclaw/openclaw) (MIT). The router lives in `src/server/llm/routing/` and is engaged whenever `LLM_ALLOWED_PROVIDERS` is set. With it unset, calls go straight to the configured `LLM_PROVIDER` (legacy fast path).

**Detection layers** (in order):
1. **CLI auth files** — `~/.codex/auth.json`, `~/.claude/.credentials.json`, `~/.gemini/oauth_creds.json`, gcloud ADC
2. **Env-key priority chain** per provider:
   - `READABLE_LIVE_<PROV>_KEY` short-circuits (returns alone)
   - `<PROV>_API_KEYS` (comma/whitespace/semicolon list) + `<PROV>_API_KEY` + `<PROV>_API_KEY_*` (numbered) all merge, deduped

**Cooldown ladder** (per profile, after a failed call):
- Transient (rate_limit / overloaded / timeout / unknown): 1m → 5m → 25m → 1h cap
- Billing: 5h → 24h cap
- `auth_permanent` disables the profile until manually cleared

**Fallback advances** on `auth | rate_limit | overloaded | billing | timeout | model_not_found | unknown` and FAILS FAST on `auth_permanent | format`. Probe-throttled at 30 s per provider.

Round-robin order within a provider: `oauth > token > api_key`, then `lastUsed` ascending, then cooldowns moved to the end.

Free OpenRouter models are configured per task (`models.json`):
- `paper_summary` → `deepseek/deepseek-chat-v3.1:free`
- `qa` → `meta-llama/llama-3.3-70b-instruct:free`
- `selection_summary` → `qwen/qwen3-235b-a22b:free`

## Pluggable embeddings

`EMBEDDING_PROVIDER=openai|openrouter` selects the active embedder. **Each provider gets its own Qdrant collection** sized to that model's native dimension (`paper_chunks_<slug(provider+model)>`) — switching providers queries a different collection, so vector spaces never mix. Re-ingest a paper after switching providers.

Use `pnpm embeddings:probe` to discover a remote model's native dim if the API ignores the `dimensions` parameter.

## External services & policies

Readable pulls metadata and PDFs from arXiv. Make sure your deployment complies with the [arXiv API access guidelines](https://info.arxiv.org/help/api/index.html) and sets an identifying `ARXIV_CONTACT_EMAIL`. The ingestion pipeline may download PDFs directly from arXiv mirrors; review their terms before production use.

Persona data is stored in your own Postgres database (`persona_concepts`, `interactions`). Nothing leaves your deployment except the LLM / embedding requests, which only contain paper text + the question or summarization task.

## BlockEditor architecture

Readable now uses a single editor surface: `src/app/components/block-editor/`.

- **Single routed editor entry point**: `ReaderWorkspace` renders `BlockEditor` for paper workspaces.
- **Unified command system**: Slash commands and research actions are registered in `block-editor/commands.ts` and executed via `block-editor/commandHandlers.ts` + `block-editor/apiHandlers.ts`.
- **Shared editor intent contract**: Cross-component editor intent events are defined in `block-editor/intents.ts`.
- **Composable block model**: Editing is driven by typed blocks (`types.ts`) and block renderers under `block-editor/blocks/`.
- **Locked research output**: API-generated blocks remain read-only by default and can be explicitly unlocked.

The legacy `src/app/components/editor/` implementation has been removed. Migration details are captured in `docs/CLEANUP_SUMMARY.md`.

## Next steps

- Review `docs/PRIVACY.md` for data-handling notes.
- Check `docs/PLAN-notion-ui.md` for the implementation plan.
- See `docs/CLEANUP_SUMMARY.md` for migration notes.
