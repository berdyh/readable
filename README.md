# Readable

Readable is a Next.js application that ingests arXiv papers, builds a retrieval graph in Weaviate, and serves persona-aware summaries plus question answering. The system can enrich responses with persona context fetched from Kontext.dev while keeping raw mailbox data out of the runtime.

## Prerequisites

- Node.js 18.18+ (Next.js 16 requirement)
- [pnpm](https://pnpm.io) 9.x (the repository is configured with `packageManager: pnpm@9.12.0`)
- Access to:
  - OpenAI API (summaries, Q&A)
  - Weaviate instance (paper/figure/reference store + persona graph)
  - Kontext.dev API (optional persona enrichment)
  - arXiv and Semantic Scholar APIs for metadata

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Create a local environment file:
   ```bash
   cp .env.local.example .env.local
   ```
3. Populate `.env.local`:
   - **Required**
     - `OPENAI_API_KEY`
     - `WEAVIATE_URL` (e.g. `https://cluster.weaviate.network`)
     - `WEAVIATE_API_KEY`
     - `SEMANTIC_SCHOLAR_KEY`
   - **Recommended**
     - `KONTEXT_API_KEY` and `KONTEXT_API_URL` for persona-aware prompts
     - `POSTHOG_KEY` for analytics
   - **Model + pipeline switches**
     - `OPENAI_SUMMARY_MODEL` (defaults to `gpt-4o-mini`)
     - `ENABLE_OCR_FALLBACK`, `DEEPSEEK_OCR_URL`, `GROBID_URL` to tune the ingestion pipeline
     - `ARXIV_API_BASE_URL`, `AR5IV_BASE_URL`, and `ARXIV_CONTACT_EMAIL` to match your arXiv integration policy
     - Timeouts such as `INGEST_*_TIMEOUT_MS` for long-running PDF work

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
- `pnpm test:weaviate` -> smoke test that the configured Weaviate cluster is reachable, initialized, and able to perform hybrid search

## Data flow overview

1. **Ingest** - fetch arXiv metadata, prefer ar5iv HTML, fall back to PDF (PDF.js or OCR via DeepSeek) and GROBID. Parsed sections, figures, and references land in Weaviate.
2. **Summaries** - load persona context (`systemPrompt`) from Kontext or the persona graph, gather relevant paper sections, and prompt OpenAI for structured JSON.
3. **Q&A** - perform hybrid retrieval in Weaviate constrained to the selected paper, combine chunks/figures/citations, and answer with grounded citations.

See `API.md` for JSON contracts if you are integrating with the backend programmatically.

## Working with personas & models

- Personas are stored in Weaviate as the primary source of truth. Kontext is queried per request when an external account is linked, and only a derived system prompt is retained.
- To switch LLMs, set `OPENAI_SUMMARY_MODEL` (and matching settings in `src/server/summarize/openai.ts` if custom parameters are needed).
- For self-hosted or Azure OpenAI deployments, configure `OPENAI_API_BASE_URL`, `OPENAI_ORGANIZATION`, and `OPENAI_PROJECT`.

## External services & policies

Readable pulls metadata and PDFs from arXiv. Make sure your deployment complies with the [arXiv API access guidelines](https://info.arxiv.org/help/api/index.html) and sets an identifying `ARXIV_CONTACT_EMAIL`. The ingestion pipeline may download PDFs directly from arXiv mirrors; review their terms before production use.

Kontext API usage follows their [Get Context](https://docs.kontext.dev/api-reference/get-context) contract. Persona data remains in your Weaviate cluster; no raw emails or documents leave Kontext.

## Next steps

- Review `PRIVACY.md` for data-handling notes.
- Check `TASKS.md` for outstanding operational to-dos tied to the project plan.
