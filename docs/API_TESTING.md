# API Testing Guide

Readable has two API proof loops:

- Offline route checks: validate routing, payload errors, and Clerk auth gates without external services.
- Live API checks: call real Clerk-protected and provider-backed endpoints.

## Offline Route Checks

Start the dev server, then run the default API harness:

```bash
# Terminal 1
pnpm dev

# Terminal 2
pnpm test:api
```

This mode intentionally expects some non-2xx responses. For example, protected routes should return `401` without a Clerk session token, and malformed payloads should return `400` before any provider work starts. It does not require Postgres data, Qdrant, arXiv, Clerk credentials, or LLM keys.

## Live External-Service Checks

Use live mode only when the local stack and credentials are configured:

```bash
pnpm dev

TEST_AUTH_TOKEN=<clerk-session-token> \
TEST_LIVE_PAPER_ID=<paper-id-that-exists-in-postgres> \
TEST_LIVE_ARXIV_ID=2401.00001 \
pnpm test:api -- --live
```

Optional PDF extraction coverage:

```bash
TEST_AUTH_TOKEN=<clerk-session-token> \
TEST_LIVE_PAPER_ID=<paper-id-that-exists-in-postgres> \
TEST_PDF_PATH=/absolute/path/to/paper.pdf \
pnpm test:api -- --live
```

The Clerk token should be a session token for a development test user. The practical automation path is to create or select a Clerk test user, create a session, create a session token, then pass it as `Authorization: Bearer <token>` through `TEST_AUTH_TOKEN`.

## Manual Endpoint Notes

### Health

`GET /api/health`

```bash
curl http://localhost:3000/api/health
```

Expected: `200` with `{ "status": "ok", "timestamp": "..." }`.

### Paper Q&A

`POST /api/qa`

Requires Clerk auth, an existing `paperId`, Postgres, Qdrant, and a configured LLM path.

```bash
curl -X POST http://localhost:3000/api/qa \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paperId":"your-paper-id","question":"What is this paper about?"}'
```

### Summarize

`POST /api/summarize`

Requires Clerk auth, an existing `paperId`, Postgres, and a configured LLM path.

```bash
curl -X POST http://localhost:3000/api/summarize \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paperId":"your-paper-id"}'
```

### Ingest

`POST /api/ingest`

Requires Clerk auth, arXiv, Postgres, Qdrant, and an active embedder.

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"arxivId":"2401.00001"}'
```

### Extract Research Paper

`POST /api/extract-research-paper`

Requires Clerk auth. OCR services are optional and only used when OCR fallback is enabled and needed.

```bash
curl -X POST http://localhost:3000/api/extract-research-paper \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -F "pdf=@/path/to/paper.pdf"
```

### Editor Selection APIs

`POST /api/editor/selection/summary`

Requires Clerk auth, Postgres, Qdrant, and a configured LLM path.

```bash
curl -X POST http://localhost:3000/api/editor/selection/summary \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paperId":"your-paper-id","selection":{"text":"selected text"}}'
```

`POST /api/editor/selection/figures`

Requires Postgres and Qdrant.

```bash
curl -X POST http://localhost:3000/api/editor/selection/figures \
  -H "Content-Type: application/json" \
  -d '{"paperId":"your-paper-id","selection":{"text":"selected text"}}'
```

`POST /api/editor/selection/citations`

Requires Postgres and Qdrant.

```bash
curl -X POST http://localhost:3000/api/editor/selection/citations \
  -H "Content-Type: application/json" \
  -d '{"paperId":"your-paper-id","selection":{"text":"selected text"}}'
```

### Editor arXiv Ingest

`POST /api/editor/ingest/arxiv`

Requires arXiv, Postgres, Qdrant, and an active embedder.

```bash
curl -X POST http://localhost:3000/api/editor/ingest/arxiv \
  -H "Content-Type: application/json" \
  -d '{"target":"2401.00001"}'
```

### Chat Session and History

`POST /api/chat/session`, `GET /api/chat/history`, `POST /api/chat/history`, and `DELETE /api/chat/history`

Chat sessions and messages are persisted in Postgres and scoped to the authenticated Clerk user. They are not in-memory and do not survive by bypassing Clerk auth.

```bash
curl -X POST http://localhost:3000/api/chat/session \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"paperId":"your-paper-id"}'

curl "http://localhost:3000/api/chat/history?paperId=your-paper-id" \
  -H "Authorization: Bearer $TEST_AUTH_TOKEN"
```

## Error Taxonomy

- `400 Bad Request`: malformed JSON, missing required fields, or invalid message/selection payloads.
- `401 Unauthorized`: Clerk session is missing or invalid on protected routes.
- `403 Forbidden`: authenticated user is trying to mutate a chat session they do not own.
- `404 Not Found`: requested paper content does not exist for summary-style reads.
- `500 Internal Server Error`: local configuration or persistence failure.
- `502 Bad Gateway`: upstream provider, arXiv, ingest, vector, or LLM failure.

## Source-Click Accessibility QA

Use this checklist for browser QA after UI or citation/source changes:

1. Sign in through Clerk and open a paper workspace.
2. Ask a Q&A question that returns citations, or use editor selection actions that insert figures/citations.
3. Tab to each citation/source control and confirm the visible focus ring is present.
4. Activate each control with `Enter` or `Space` and confirm it reveals or navigates to the referenced source.
5. Click the same controls with a mouse and verify the paper/editor focus does not jump unexpectedly.
6. Repeat at a narrow viewport and confirm source controls remain visible, named, and non-overlapping.
