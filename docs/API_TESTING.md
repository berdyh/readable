# API Endpoints Testing Guide

This document provides a guide for testing all API endpoints in the application.

## Quick Test Script

A test script has been created to verify all endpoints are properly routed:

```bash
# Terminal 1: Start the dev server
pnpm dev

# Terminal 2: Run the test script
pnpm exec tsx scripts/test-api-endpoints.ts
```

## Manual Testing Guide

### 1. Health Check ✅

**Endpoint:** `GET /api/health`

- **Status:** Always works (no dependencies)
- **Test:**
  ```bash
  curl http://localhost:3000/api/health
  ```
- **Expected:** `{"status":"ok","timestamp":"..."}`

### 2. Summarize 📝

**Endpoint:** `POST /api/summarize`

- **Required:** `paperId` (must exist in Postgres `papers` table)
- **Dependencies:** Postgres, Qdrant, OpenAI API
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/summarize \
    -H "Content-Type: application/json" \
    -d '{"paperId":"your-paper-id"}'
  ```

### 3. Q&A 💬

**Endpoint:** `POST /api/qa`

- **Required:** `paperId`, `question`
- **Dependencies:** Postgres, Qdrant, OpenAI API
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/qa \
    -H "Content-Type: application/json" \
    -d '{"paperId":"your-paper-id","question":"What is this paper about?"}'
  ```

### 4. Ingest 📥

**Endpoint:** `POST /api/ingest`

- **Required:** `arxivId`
- **Dependencies:** arXiv API, Postgres, Qdrant, OpenAI, OpenAI (for embeddings + LLM), GROBID (optional), OCR service (optional)
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/ingest \
    -H "Content-Type: application/json" \
    -d '{"arxivId":"2401.00001"}'
  ```
- **Note:** This is a long-running operation

### 5. Extract Research Paper 📄

**Endpoint:** `POST /api/extract-research-paper`

- **Required:** PDF file via `formData`
- **Dependencies:** PDF.js, OCR service (optional)
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/extract-research-paper \
    -F "pdf=@/path/to/paper.pdf"
  ```

### 6. Editor Selection Summary 📋

**Endpoint:** `POST /api/editor/selection/summary`

- **Required:** `paperId`, `selection` (with `text`)
- **Dependencies:** Postgres, Qdrant, OpenAI API
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/editor/selection/summary \
    -H "Content-Type: application/json" \
    -d '{"paperId":"your-paper-id","selection":{"text":"selected text"}}'
  ```

### 7. Editor Selection Figures 📊

**Endpoint:** `POST /api/editor/selection/figures`

- **Required:** `paperId`, `selection`
- **Dependencies:** Postgres, Qdrant
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/editor/selection/figures \
    -H "Content-Type: application/json" \
    -d '{"paperId":"your-paper-id","selection":{"text":"selected text"}}'
  ```

### 8. Editor Selection Citations 📚

**Endpoint:** `POST /api/editor/selection/citations`

- **Required:** `paperId`, `selection`
- **Dependencies:** Postgres, Qdrant
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/editor/selection/citations \
    -H "Content-Type: application/json" \
    -d '{"paperId":"your-paper-id","selection":{"text":"selected text"}}'
  ```

### 9. Editor Ingest ArXiv 🔗

**Endpoint:** `POST /api/editor/ingest/arxiv`

- **Required:** `target` (arXiv ID or URL)
- **Dependencies:** arXiv API, Postgres, Qdrant, OpenAI embeddings
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/editor/ingest/arxiv \
    -H "Content-Type: application/json" \
    -d '{"target":"2401.00001"}'
  ```

### 10. Chat Session 💭

**Endpoint:** `POST /api/chat/session`

- **Required:** `paperId`
- **Dependencies:** None (in-memory storage)
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/chat/session \
    -H "Content-Type: application/json" \
    -d '{"paperId":"your-paper-id"}'
  ```

### 11. Chat History (GET) 📜

**Endpoint:** `GET /api/chat/history`

- **Required:** `sessionId` OR `paperId`
- **Dependencies:** None (in-memory storage)
- **Test:**
  ```bash
  curl "http://localhost:3000/api/chat/history?paperId=your-paper-id"
  ```

### 12. Chat History (POST) 💾

**Endpoint:** `POST /api/chat/history`

- **Required:** `sessionId`, `paperId`, `message` or `messages`
- **Dependencies:** None (in-memory storage)
- **Test:**
  ```bash
  curl -X POST http://localhost:3000/api/chat/history \
    -H "Content-Type: application/json" \
    -d '{"sessionId":"test-session","paperId":"your-paper-id","message":{"id":"msg1","role":"user","content":"Hello","createdAt":1234567890}}'
  ```

## Testing Status

### ✅ Can Test Without External Services

- `/api/health` - Always works
- `/api/chat/session` - In-memory storage
- `/api/chat/history` - In-memory storage

### ⚠️ Require External Services

All other endpoints require:

- **Postgres** - Source of truth for papers, chunks, figures, citations, persona state
- **Qdrant** - Vector index for paper-chunk embeddings
- **OpenAI API** - For summarization, Q&A, and chunk embeddings
- **arXiv API** - For paper ingestion
- **Optional:** GROBID, OCR services, Semantic Scholar API

## Expected Behaviors

### Missing Required Fields

All endpoints should return `400 Bad Request` with error message when required fields are missing.

### Missing External Services

Endpoints requiring external services will return `502 Bad Gateway` or `500 Internal Server Error` if services are unavailable.

### Successful Responses

Most endpoints return `200 OK` or `201 Created` with JSON data.

## Notes

- The test script (`scripts/test-api-endpoints.ts`) tests routing and error handling even without full configuration
- In-memory storage (chat history) will reset on server restart
- Some endpoints have long timeouts (e.g., ingestion can take minutes)
