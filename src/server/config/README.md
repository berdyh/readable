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

- **LLM Providers** (60s): OpenAI, Anthropic, Gemini - LLM operations can be slow
- **Kontext.dev** (8s): Quick persona prompt fetch
- **Weaviate** (20s): Database operations
- **Ingestion**:
  - Fetch/PDF (20s): HTTP requests
  - GROBID (60s): PDF parsing can be slow
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

These config files respect environment variable overrides:

- `{SERVICE}_TIMEOUT_MS` - Override timeout for a service
- `{SERVICE}_API_BASE_URL` or `{SERVICE}_URL` - Override URL for a service

Example:

```bash
OPENAI_TIMEOUT_MS=90000  # Override default 60s
KONTEXT_API_URL=https://custom-kontext.example.com  # Override default URL
```
