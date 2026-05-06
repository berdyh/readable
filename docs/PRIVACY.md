# Privacy Notes

Readable is a self-hosted application. You control the environment, the backing databases, and the external API keys you provide. This document outlines what the app persists, which services it calls, and how persona data is handled.

## Data the app stores

- **Paper knowledge graph (Postgres + Qdrant)**
  - Postgres holds ingested sections, paragraph text, citation metadata, figure captions, and light PDF analytics — plus persona concepts, interactions, and the cached `systemPrompt` returned by Kontext.dev.
  - Qdrant holds embedding vectors for paper chunks (no raw text — only the vector and a small payload referencing the Postgres row).
  - Both stores live entirely inside the deployment you control.
- **Runtime metadata**
  - Server-side logs (Next.js `console.*`) stream to stderr. No log shipping is performed by default.
  - PostHog analytics run client-side when `POSTHOG_KEY` is configured; disable the key to opt out.

The app does not persist raw PDFs or user-uploaded mailbox/files. Parsed figure images can be stored in the location you configure inside the ingestion pipeline (for example object storage), but those paths are under your control.

## External services

- **arXiv and ar5iv** - provide paper metadata, abstracts, and HTML renditions. Control access via `ARXIV_CONTACT_EMAIL`, `ARXIV_API_BASE_URL`, and `AR5IV_BASE_URL`.
- **GROBID / DeepSeek OCR / PDF.js** - optional services used during ingestion for PDF parsing. You supply the endpoints via environment variables.
- **OpenAI** - generates summaries and answers. Request payloads include paper snippets, persona context, and user questions.
- **Kontext.dev** - optional persona enrichment. The app sends a user identifier and expects a derived `systemPrompt` string in return. Raw mailbox or document data never enters Readable; Kontext keeps that in its own infrastructure.

If you do not provide API keys for a service, that integration is skipped.

## Persona handling

1. When a user connects external data through Kontext, the backend calls `GET /v1/context/get` (configurable via `KONTEXT_SYSTEM_PROMPT_PATH`).
2. Kontext responds with a tailored system prompt. The prompt is stored in memory for the duration of the request and may be cached transiently in your hosting layer, but it is not written to disk.
3. Persona traits are persisted in Postgres (`persona_concepts`, `interactions`, and `kontext_prompts` — schema defined in `src/server/db/schema.ts`). You choose the storage tier (managed Postgres or self-hosted).

No raw mailbox content, document attachments, or OAuth tokens are saved in Readable. Users can remove persona data by deleting the corresponding rows in `persona_concepts`, `interactions`, and `kontext_prompts`.

## Your responsibilities

- Provide clear terms of service and privacy disclosures to end-users of your deployment.
- Configure TLS for Postgres, Qdrant, Kontext, and any custom ingestion endpoints.
- Manage retention policies in Postgres / Qdrant and any object storage you attach for figures.
- Rotate API keys and secrets in `.env.local` regularly.
- Ensure compliance with arXiv API usage guidelines and the privacy policies of any connected services.

Questions or suggestions? Open an issue in your fork or document them in `TASKS.md` for follow-up.
