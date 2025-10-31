# API Connections Analysis

This document analyzes all external API connections used in the Readable backend and their necessity.

## External API Services

### 1. OpenAI API
**Purpose**: LLM inference for summarization and Q&A

**Usage**:
- Paper summarization (`src/server/summarize/openai.ts`)
- Q&A responses (`src/server/qa/openai.ts`)
- Selection summaries (`src/server/editor/selection.ts`)

**Endpoints**:
- `POST {baseUrl}/chat/completions`

**Configuration**:
- `OPENAI_API_KEY` (required)
- `OPENAI_API_BASE_URL` (required)
- `OPENAI_SUMMARY_MODEL` (required for summaries)
- `OPENAI_QA_MODEL` (required for Q&A)
- `OPENAI_ORGANIZATION` (optional)
- `OPENAI_PROJECT` (optional)
- `OPENAI_TIMEOUT_MS` (default: 60s)

**Necessity**: ⭐⭐⭐ **CRITICAL** - Core functionality depends on this

**Recommendations**:
- Should support multiple providers (OpenAI, Anthropic, Gemini)
- Currently hardcoded to OpenAI format
- LLM provider abstraction needed

---

### 2. arXiv API
**Purpose**: Fetch paper metadata (title, abstract, authors, publication dates)

**Usage**:
- Paper ingestion (`src/server/ingest/arxiv.ts`)
- Citation enrichment during Q&A (`src/server/qa/context.ts`)

**Endpoints**:
- `GET https://export.arxiv.org/api/query?id_list={arxivId}`

**Configuration**:
- `ARXIV_API_BASE_URL` (default: `https://export.arxiv.org/api/query`)
- `ARXIV_CONTACT_EMAIL` (optional, for User-Agent)

**Necessity**: ⭐⭐⭐ **CRITICAL** - Required for paper ingestion

**Recommendations**:
- Keep as-is - necessary for metadata
- Add retry logic for transient failures
- Cache responses to reduce API calls

---

### 3. ar5iv Service
**Purpose**: Fetch HTML rendition of arXiv papers (LaTeXML conversion)

**Usage**:
- Paper ingestion as primary HTML source (`src/server/ingest/ar5iv.ts`)
- Falls back to PDF parsing if HTML unavailable

**Endpoints**:
- `GET https://ar5iv.org/html/{arxivId}`

**Configuration**:
- `AR5IV_BASE_URL` (default: `https://ar5iv.org/html`)

**Necessity**: ⭐⭐ **IMPORTANT** - Significantly improves ingestion quality

**Recommendations**:
- Keep as都市 source for HTML
- Already has fallback to PDF parsing
- No API key required - free service

---

### 4. Kontext.dev API
**Purpose**: Fetch persona-aware system prompts for personalization

**Usage**:
- Paper summarization (`src/server/summarize/kontext.ts`)
- Selection summaries (`src/server/editor/selection.ts`)

**Endpoints**:
- `POST https://api.kontext.dev/v1/context/get`

**Configuration**:
- `KONTEXT_API_KEY` (optional)
- `KONTEXT_API_URL` (default: `https://api.kontext.dev`)
- `KONTEXT_SYSTEM_PROMPT_PATH` (default: `/v1/context/get`)
- `KONTEXT_TIMEOUT_MS` (default: 8s)

**Necessity**: ⭐ **OPTIONAL** - Nice-to-have for personalization

**Recommendations**:
- Keep as optional (already gracefully handles failures)
- Add local caching to reduce API calls
- Consider making persona prompts stored locally in Weaviate instead

---

### 5. GROBID Service
**Purpose**: Extract structured data from PDFs (sections, citations, figures)

**Usage**:
- PDF parsing when HTML unavailable (`src/server/ingest/grobid.ts`)

**Endpoints**:
- `POST {GROBID_URL}/processFulltextDocument` (or other GROBID endpoints)

**Configuration**:
- `GROBID_URL` (optional - service must be self-hosted)
- `INGEST_GROBID_TIMEOUT_MS` (default: 30s)

**Necessity**: ⭐⭐ **IMPORTANT** - Provides structure extraction fallback

**Recommendations**:
- Keep for PDF fallback scenarios
- Self-hosted service, no API key needed
- Consider if ar5iv coverage makes this less critical

---

### 6. DeepSeek OCR / RunPod
**Purpose**: OCR for scanned PDFs and papers with poor text extraction

**Usage**:
- OCR fallback during ingestion (`src/server/ingest/ocr.ts`)

**Endpoints**:
- Option 1: Direct DeepSeek OCR service: `POST {DEEPSEEK_OCR_URL}`
- Option 2: RunPod endpoint: `POST https://api.runpod.ai/v2/{endpointId}/runsync`

**Configuration**:
- `DEEPSEEK_OCR_URL` (optional)
- `RUNPOD_API_KEY` (optional, required if using RunPod)
- `RUNPOD_ENDPOINT_ID` (optional, required if using RunPod)
- `ENABLE_OCR_FALLBACK` (default: `true`)
- `INGEST_OCR_TIMEOUT_MS` (default: 120s)

**Necessity**: ⭐ **OPTIONAL** - Only needed for scanned PDFs

**Recommendations**:
- Keep as optional fallback
- Already has graceful degradation (falls back to PDF.js)
- Could be replaced with other OCR services if needed

---

### 7. Weaviate
**Purpose**: Vector database for storing and searching趁着 content

**Usage**:
- All data persistence (`src/server/weaviate/`)
- Hybrid search for RAG (`src/server/weaviate/search.ts`)

**Endpoints**:
- GraphQL API for queries
- REST API for batch operations
- Connection via Weaviate TypeScript client

**Configuration**:
- `WEAVIATE_URL` (required)
- `WEAVIATE_API_KEY` (optional, for cloud)
- `WEAVIATE_GRPC_URL` (optional)

**Necessity**: ⭐⭐⭐ **CRITICAL** - Core vectordb functionality

**Recommendations**:
- Keep as-is - this is the database layer
- Consider adding connection pooling
- Add health check monitoring

---

## Summary Table

| Service | Necessity | Required | Fallback Available | API Key Needed |
|---------|-----------|----------|-------------------|----------------|
| OpenAI | Critical | ✅ | ❌ | ✅ |
| arXiv | Critical | ✅ | ❌ | ❌ |
| ar5iv | Important | ✅ | ✅ (PDF) | ❌ |
| Kontext | Optional | ❌ | ✅ (no persona) | ✅ |
| GROBID | Important | ❌ | ✅ (ar5iv) | ❌ |
| DeepSeek OCR | Optional | ❌ | ✅ (PDF.js) | ✅ |
| Weaviate | Critical | ✅ | ❌ | Optional |

## Recommendations

### High Priority
1. **Abstract LLM Provider**: Create provider abstraction to support OpenAI, Anthropic, Gemini
   - Currently hardcoded to OpenAI format
   - Should support different API formats and response structures

### Medium Priority
2. **Add Retry Logic**: For arXiv and ar5iv API calls
3. **Add Caching**: For arXiv metadata and Kontext prompts
4. **Error Handling**: Improve error messages for API failures

### Low Priority
5. **Make Kontext Optional**: Already optional, but consider storing persona prompts in Weaviate
6. **Monitor API Usage**: Add metrics for external API calls

