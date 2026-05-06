# Readable

Readable is a Next.js application that ingests arXiv papers, persists structured records in Postgres, indexes embeddings in Qdrant for hybrid retrieval, and serves persona-aware summaries plus question answering. The system can enrich responses with persona context fetched from Kontext.dev while keeping raw mailbox data out of the runtime.

## Prerequisites

- Node.js 18.18+ (Next.js 16 requirement)
- [pnpm](https://pnpm.io) 9.x (the repository is configured with `packageManager: pnpm@9.12.0`)
- Docker (for the bundled Postgres + Qdrant compose stack) **or** managed equivalents
- Access to:
  - OpenAI API (summaries, Q&A, embeddings)
  - Postgres 14+ (paper/figure/reference store, persona state, kontext prompt cache)
  - Qdrant (vector index for paper-chunk embeddings)
  - Kontext.dev API (optional persona enrichment)
  - arXiv and Semantic Scholar APIs for metadata

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
     - `SEMANTIC_SCHOLAR_KEY`
   - **Recommended**
     - `KONTEXT_API_KEY` and `KONTEXT_API_URL` for persona-aware prompts
     - `POSTHOG_KEY` for analytics
   - **Model + pipeline switches**
     - `OPENAI_SUMMARY_MODEL` (defaults to `gpt-4o-mini`)
     - `ENABLE_OCR_FALLBACK`, `DEEPSEEK_OCR_URL`, `GROBID_URL` to tune the ingestion pipeline
     - `ARXIV_API_BASE_URL`, `AR5IV_BASE_URL`, and `ARXIV_CONTACT_EMAIL` to match your arXiv integration policy
     - Timeouts such as `INGEST_*_TIMEOUT_MS` for long-running PDF work
5. Apply the Postgres schema (idempotent — also runs automatically on first request):
   ```bash
   pnpm db:migrate
   ```

Environment values can point to managed services or local Docker containers. The repo ships a certificate authority placeholder at `certs/kontext-ca.crt` for contexts where Kontext requires a custom CA chain (`NODE_EXTRA_CA_CERTS`).

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

## Data flow overview

1. **Ingest** - fetch arXiv metadata, prefer ar5iv HTML, fall back to PDF (PDF.js or OCR via DeepSeek) and GROBID. Parsed sections, figures, and references are upserted into Postgres; chunk embeddings are written to Qdrant.
2. **Summaries** - load persona context (`systemPrompt`) from Kontext or the persona graph, gather relevant paper sections from Postgres, and prompt OpenAI for structured JSON.
3. **Q&A** - run a hybrid retrieval (Qdrant vector search + Postgres `tsvector` full-text search fused via Reciprocal Rank Fusion) constrained to the selected paper, combine chunks/figures/citations, and answer with grounded citations.

See `docs/API_ANALYSIS.md` and `docs/API_TESTING.md` for API documentation and testing information.

## Working with personas & models

- Personas are stored in Postgres as the primary source of truth. Kontext is queried per request when an external account is linked, and only a derived system prompt is retained (cached in the `kontext_prompts` table).
- To switch LLMs, set `OPENAI_SUMMARY_MODEL` (and matching settings in `src/server/summarize/openai.ts` if custom parameters are needed).
- For self-hosted or Azure OpenAI deployments, configure `OPENAI_API_BASE_URL`, `OPENAI_ORGANIZATION`, and `OPENAI_PROJECT`.

## External services & policies

Readable pulls metadata and PDFs from arXiv. Make sure your deployment complies with the [arXiv API access guidelines](https://info.arxiv.org/help/api/index.html) and sets an identifying `ARXIV_CONTACT_EMAIL`. The ingestion pipeline may download PDFs directly from arXiv mirrors; review their terms before production use.

Kontext API usage follows their [Get Context](https://docs.kontext.dev/api-reference/get-context) contract. Persona data remains in your Postgres database; no raw emails or documents leave Kontext.

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
