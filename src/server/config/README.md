# Configuration Files

This directory contains centralized configuration for timeouts and URLs.

## Files

- `defaults.ts` - Default timeout values and API base URLs for all services

## Philosophy

**Timeouts and URLs are centralized here with sensible defaults.** Environment variables can still override these defaults, but developers don't need to set them unless they have specific requirements.

### Why separate config files?

1. **Cleaner .env file**: Only API keys and essential config in `.env.local`
2. **Better defaults**: Timeouts are clearly defined and documented
3. **Easier maintenance**: Update defaults in one place
4. **Type safety**: TypeScript ensures correct values

### Timeouts

All timeouts have defaults that work for most use cases:

- **LLM Providers** (60s): OpenAI, Anthropic, Gemini, OpenRouter - LLM operations can be slow
- **Postgres** (20s): Statement timeout for relational queries
- **Qdrant** (20s): Vector search request timeout
- **Semantic Scholar** (10s): Citation enrichment lookups
- **Ingestion**:
  - Fetch/PDF (20s): HTTP requests
  - OCR (90s): Slowest operation

**Override only if needed**: Most deployments won't need to change these.

### URLs

URLs have defaults for standard public endpoints. Override if:

- Using proxy servers
- Self-hosted services
- Custom endpoints

## Usage

```typescript
import { getTimeout, getUrl } from "@/server/config/defaults";

// Get timeout with env var override
const timeout = getTimeout("openai", "OPENAI_TIMEOUT_MS"); // Checks env first

// Get URL with env var override
const url = getUrl("openai", "OPENAI_API_BASE_URL"); // Checks env first
```

## Environment Variables

There is no automatic `{SERVICE}_TIMEOUT_MS` lookup — `getTimeout()` and `getUrl()` take the environment
variable name as an explicit second argument, so the override name is whatever the call site passes. Grep
for the call site to find the real name before documenting or setting one.

```bash
OPENAI_TIMEOUT_MS=90000                          # getTimeout('openai', 'OPENAI_TIMEOUT_MS')
ARXIV_API_BASE_URL=https://mirror.example.com    # getUrl('arxiv', 'ARXIV_API_BASE_URL')
```

Known services: `openai`, `anthropic`, `gemini`, `openrouter`, `postgres`, `qdrant`, `semanticScholar`,
`ingest.fetch`, `ingest.pdf`, `ingest.ocr` (timeouts); `openai`, `anthropic`, `gemini`, `openrouter`,
`arxiv`, `ar5iv`, `semanticScholar`, `runpod` (URLs).
