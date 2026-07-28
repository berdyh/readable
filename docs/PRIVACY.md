# Privacy Notes

Readable is a self-hosted application. You control the environment, the backing databases, and the external API keys you provide. This document outlines what the app persists, which services it calls, and how persona data is handled.

## Data the app stores

- **Paper knowledge graph (Postgres + Qdrant)**
  - Postgres holds ingested sections, paragraph text, citation metadata, figure captions, and light PDF analytics — plus persona concepts, a log of QA / summarize interactions, and persisted chat sessions/messages (`chat_sessions`, `chat_messages`, scoped to the Clerk user).
  - Qdrant holds embedding vectors for paper chunks (no raw text — only the vector and a small payload referencing the Postgres row). Each embedding provider gets its own collection sized to that model's native dimension.
  - Both stores live entirely inside the deployment you control.
- **Skills (`persona_concepts`) + interactions log**
  - Every Q&A and summarize call asks the configured LLM for a short list of concepts, upserts them to `persona_concepts`, and logs one row in `interactions` (prompt, response, citing chunk ids, extracted concept ids). Anonymous calls (no `userId`) are not tracked.
  - Surface: `GET /api/skills` returns the tracked concepts for the caller's own Clerk session; the `SkillsPanel` UI shows them as chips. There is no endpoint for reading another user's concepts — the old `GET /api/skills/[userId]` is retired and returns `410 Gone`.
- **Routing-layer state (`~/.readable/`)**
  - When the OpenClaw-style routing layer is engaged (`LLM_ALLOWED_PROVIDERS` set), the app persists per-provider auth profiles + cooldown state to `~/.readable/agents/<agentId>/{auth-profiles.json,auth-state.json}` (path overridable via `READABLE_HOME` / `READABLE_STATE_DIR`). Files are written with mode `0600` and the directory with `0700`. Profiles include OAuth tokens read from local CLIs (`~/.codex/auth.json`, `~/.claude/.credentials.json`, `~/.gemini/oauth_creds.json`) and API keys from environment variables.
- **Runtime metadata**
  - Server-side logs (Next.js `console.*`) stream to stderr. No log shipping is performed by default.
  - PostHog analytics run client-side when `POSTHOG_KEY` is configured; disable the key to opt out.

The app does not persist raw PDFs or user-uploaded mailbox/files. Parsed figure images can be stored in the location you configure inside the ingestion pipeline (for example object storage), but those paths are under your control.

## External services

- **arXiv and ar5iv** - provide paper metadata, abstracts, and HTML renditions. Control access via `ARXIV_CONTACT_EMAIL`, `ARXIV_API_BASE_URL`, and `AR5IV_BASE_URL`.
- **DeepSeek OCR / PDF.js** - optional OCR services used during ingestion for image-only PDFs. PDF.js runs in-process for text PDFs; OCR endpoints (DeepSeek via RunPod) are only contacted if `ENABLE_OCR_FALLBACK` is set and a text-extraction yields too few characters.
- **LLM provider** (configurable: OpenAI, Anthropic, Google Gemini, or OpenRouter) - generates summaries, Q&A answers, and the concept lists used to populate `persona_concepts`. Request payloads include paper snippets, persona context, and the user's question. The routing layer auto-detects which providers you've authenticated and picks one; multiple can be configured as a fallback chain via `LLM_ALLOWED_PROVIDERS`. OpenRouter additionally receives `HTTP-Referer` / `X-Title` headers for its attribution accounting.
- **Embedding provider** (configurable: OpenAI `text-embedding-3-small` or OpenRouter `nvidia/llama-nemotron-embed-vl-1b-v2:free`) - converts paper chunks into vectors for retrieval. The chosen provider sees chunk text but not user metadata.
- **Semantic Scholar** - optional citation enrichment. The app sends paper identifiers (DOI / arXiv ID / title) and receives metadata (authors, abstract, year, related papers). Works without an API key on the public rate limit.

If you do not provide API keys for a service, that integration is skipped.

## Persona handling

Persona traits are persisted in Postgres (`persona_concepts`, `interactions` — schema defined in `src/server/db/schema.ts`). You choose the storage tier (managed Postgres or self-hosted).

**Concept extraction is automatic**: every Q&A / summarize response is required (by JSON schema) to include a short list of `concepts`, which are upserted to `persona_concepts` and recorded in `interactions` via `recordPersonaSignals` (`src/server/persona/record.ts`). Concept extraction is fire-and-forget — failure to record never blocks the user-facing response. Anonymous interactions (no `userId` plumbed in the request) are NOT tracked.

OAuth tokens read from local CLIs (Codex / Claude / Gemini) are copied into `~/.readable/agents/<id>/auth-profiles.json` so the routing layer can re-use them across requests; rotating the upstream CLI credential automatically updates the file via mtime detection. No raw mailbox content or document attachments are saved in Readable. Users can remove persona + interaction data by deleting the corresponding rows in `persona_concepts` and `interactions`, and chat data by deleting the session (`DELETE /api/chat/history`), which cascades to its messages. Routing-layer credentials can be cleared by deleting `~/.readable/`.

## Your responsibilities

- Provide clear terms of service and privacy disclosures to end-users of your deployment.
- Configure TLS for Postgres, Qdrant, and any custom ingestion endpoints.
- Manage retention policies in Postgres / Qdrant and any object storage you attach for figures.
- Rotate API keys and secrets in `.env.local` regularly.
- Ensure compliance with arXiv API usage guidelines and the privacy policies of any connected services.

Questions or suggestions? Open an issue in your fork.
