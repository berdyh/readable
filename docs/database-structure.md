# Database Structure Documentation

This document describes the storage layer used by Readable: a Postgres relational store as the source of truth and a Qdrant vector index for embedding-based retrieval. They are kept in sync by deterministic UUID v5 identifiers shared across both systems.

## Overview

Readable uses two stores:

- **Postgres** — source of truth for papers, paper chunks, figures, citations, persona concepts, user interactions, and the Kontext.dev prompt cache. Postgres also provides BM25-style full-text search via a generated `tsvector` column with a GIN index.
- **Qdrant** — vector index for paper-chunk embeddings (`text-embedding-3-small`, 1536 dimensions). Each Qdrant point shares its UUID with the corresponding row in `paper_chunks`, allowing the hybrid retriever to fuse results from both stores.

Hybrid retrieval combines Postgres FTS results and Qdrant vector results using **Reciprocal Rank Fusion (k=60)** with a configurable `alpha` weighting (default `0.65`, biased toward semantic search).

## Schema (Postgres)

Authoritative DDL lives at `src/server/db/schema.ts` (exported as the `READABLE_SCHEMA_SQL` template literal) and is applied via `pnpm db:migrate` or automatically on first request through `ensureSchema()`.

### Entity Relationship Diagram

```mermaid
erDiagram
    papers ||--o{ paper_chunks : "contains"
    papers ||--o{ paper_figures : "contains"
    papers ||--o{ paper_citations : "contains"
    papers ||--o{ interactions : "associated with"

    paper_chunks ||--o{ interactions : "used in"
    paper_figures ||--o{ paper_chunks : "referenced by ID"
    paper_citations ||--o{ paper_chunks : "referenced by ID"

    persona_concepts ||--o{ interactions : "referenced in"
    kontext_prompts }o--|| papers : "optional paper scope"

    papers {
        text id PK
        text title
        text abstract
        text[] authors
        text primary_category
        text[] categories
        timestamptz published_at
        timestamptz updated_at
        text pdf_url
        int pages
    }

    paper_chunks {
        uuid id PK
        text paper_id FK
        text chunk_id
        text text
        text section
        int page_number
        int token_start
        int token_end
        text[] citations
        text[] figure_ids
        tsvector text_search "GENERATED, GIN-indexed"
    }

    paper_figures {
        uuid id PK
        text paper_id FK
        text figure_id
        text caption
        int page_number
        text image_url
    }

    paper_citations {
        uuid id PK
        text paper_id FK
        text citation_id
        text title
        text[] authors
        int year
        text source
        text doi
        text url
    }

    persona_concepts {
        uuid id PK
        text user_id
        text concept
        text description
        text first_seen_paper_id
        timestamptz learned_at
        numeric confidence
    }

    interactions {
        uuid id PK
        text user_id
        text paper_id
        text interaction_type
        text prompt
        text response
        timestamptz created_at
    }

    kontext_prompts {
        uuid id PK
        text user_id
        text persona_id
        text task_id
        text paper_id
        text system_prompt
        timestamptz fetched_at
        timestamptz expires_at
    }
```

### Tables

#### `papers`

Source of truth for paper metadata. Cascading deletes propagate to all child tables.

| Column             | Type            | Notes                            |
| ------------------ | --------------- | -------------------------------- |
| `id`               | `text` (PK)     | arXiv ID or canonical identifier |
| `title`            | `text`          |                                  |
| `abstract`         | `text`          |                                  |
| `authors`          | `text[]`        |                                  |
| `primary_category` | `text`          |                                  |
| `categories`       | `text[]`        |                                  |
| `published_at`     | `timestamptz`   |                                  |
| `updated_at`       | `timestamptz`   | Auto-updated on upsert           |
| `pdf_url`          | `text`          |                                  |
| `pages`            | `int`           | Optional page count              |

#### `paper_chunks`

Semantic chunks used for retrieval. The `text_search` column is a generated `tsvector` (English stemming) with a GIN index, giving us BM25-style ranking via `ts_rank_cd` over `websearch_to_tsquery`.

| Column        | Type        | Notes                                              |
| ------------- | ----------- | -------------------------------------------------- |
| `id`          | `uuid` (PK) | UUID v5 of `paper_id:chunk_id` (matches Qdrant ID) |
| `paper_id`    | `text` (FK) | `papers(id)` ON DELETE CASCADE                     |
| `chunk_id`    | `text`      | Stable chunk key inside the paper                  |
| `text`        | `text`      | Chunk body                                         |
| `section`     | `text`      | Heading/section name                               |
| `page_number` | `int`       |                                                    |
| `token_start` | `int`       |                                                    |
| `token_end`   | `int`       |                                                    |
| `citations`   | `text[]`    | Citation IDs referenced inline                     |
| `figure_ids`  | `text[]`    | Figure IDs referenced inline                       |
| `text_search` | `tsvector`  | `GENERATED ALWAYS AS to_tsvector('english', text)` |

Unique constraint on `(paper_id, chunk_id)`. GIN index on `text_search`. B-tree index on `(paper_id, page_number)` for page-window expansion.

#### `paper_figures`

Figures and tables with captions. Unique on `(paper_id, figure_id)`.

#### `paper_citations`

Bibliographic citations. Unique on `(paper_id, citation_id)`. Citations may be enriched with arXiv metadata at query time; the enriched form is not persisted.

#### `persona_concepts`

User knowledge graph. Unique on `(user_id, concept)`.

> **Status (2026-05):** Actively written. Every Q&A and summarize call asks the LLM for a short list of `concepts` and upserts them via `recordPersonaSignals` (`src/server/persona/record.ts`). The `SkillsPanel` UI surfaces them as chips in the workspace sidebar; the read API is `GET /api/skills/[userId]`.

#### `interactions`

Append-only log of QA / summary / feedback events.

> **Status (2026-05):** Actively written. `recordPersonaSignals` writes one row per QA / summarize call (when `userId` is set), capturing prompt, response, the chunk_ids that grounded the answer, and the persona_concept_ids that were extracted. Read-side surface (e.g. "history" view) is not yet wired.

#### `kontext_prompts`

Cache for system prompts fetched from kontext.dev. UUID is `userId:personaId:taskId:paperId` (hashed via UUID v5). Lookups use `IS NOT DISTINCT FROM` for nullable equality and `(expires_at IS NULL OR expires_at > NOW())` for freshness.

## Qdrant Collections

The collection is selected per active embedding provider (`EMBEDDING_PROVIDER=openai|openrouter`) — each provider has its own collection sized to that model's native dimension. Switching providers points the runtime at a different collection; vector spaces never mix. Re-ingest a paper after switching providers.

| Provider config | Collection name (auto-derived) | Vector size |
|---|---|---|
| `EMBEDDING_PROVIDER=openai` + `text-embedding-3-small` | `paper_chunks_openai_text_embedding_3_small` | 1536 |
| `EMBEDDING_PROVIDER=openrouter` + `nvidia/llama-nemotron-embed-vl-1b-v2:free` | `paper_chunks_openrouter_nvidia_llama_nemotron_embed_vl_1b_v2_free` | 2048 (probe to confirm) |

Override the auto-derived name with `QDRANT_COLLECTION` for stable single-provider deploys.

- **Distance**: `Cosine` (override via `QDRANT_DISTANCE`)
- **Point ID**: same UUID v5 as the corresponding `paper_chunks.id` row in Postgres
- **Payload**: `{ paperId, chunkId, section?, pageNumber?, citations?, figureIds? }`
- **Indexed payload fields**: keyword index on `paperId`, integer index on `pageNumber`

The collection is created on demand by `ensureQdrantCollection()` (in `src/server/vector/qdrant.ts`). A vector-size mismatch is treated as a fatal configuration error.

Use `pnpm embeddings:probe` to discover a remote model's native vector size when in doubt.

## UUID strategy

All cross-store IDs are UUID v5 derived from `READABLE_NAMESPACE_UUID` so the same logical record has the same UUID in Postgres and Qdrant.

| Entity            | UUID input                                     |
| ----------------- | ---------------------------------------------- |
| `paper_chunks`    | `paperId:chunkId`                              |
| `paper_figures`   | `paperId:figureId`                             |
| `paper_citations` | `paperId:citationId`                           |
| `persona_concepts`| `userId:concept`                               |
| `interactions`    | `userId:paperId:interactionType:prompt` (hashed) |
| `kontext_prompts` | `userId:personaId:taskId:paperId` (with fallbacks) |

Helpers live in `src/server/db/ids.ts`.

## Hybrid retrieval

`hybridPaperChunkSearch({ paperId, query, limit, alpha = 0.65, pageWindow, vector })` in `src/server/search/hybrid.ts`:

1. Embed `query` (skipped if a precomputed `vector` is supplied) via `embedQuery` and run a Qdrant `search` filtered by `paperId`.
2. Run a Postgres FTS query: `WHERE text_search @@ websearch_to_tsquery('english', $2) ORDER BY ts_rank_cd(text_search, ...) DESC`.
3. Combine the two ranked lists using **Reciprocal Rank Fusion** with `k = 60`, weighting Qdrant by `alpha` and Postgres by `1 - alpha`.
4. Hydrate hits from Postgres (`fetchChunksByIds`) and optionally expand the window around top hits with `fetchChunksByPageWindow`.
5. Falls back gracefully — if embeddings or Qdrant fail, returns the FTS-only ranking.

Fetch limit is `max(limit * 3, limit + 5)` to give RRF enough candidates.

## Data flows

### Ingestion

```mermaid
flowchart TD
    A[Paper PDF / HTML] --> B[ar5iv -> PDF.js -> OCR -> GROBID]
    B --> C[Extract chunks, figures, citations]
    C --> D[upsertPaper into papers]
    D --> E[upsertPaperChunks into paper_chunks]
    D --> F[upsertFigures into paper_figures]
    D --> G[upsertCitations into paper_citations]
    E --> H[embedTexts via OpenAI]
    H --> I[upsertPaperChunkVectors into Qdrant]

    style D fill:#c8e6c9
    style E fill:#c8e6c9
    style I fill:#fff9c4
```

Vector indexing is wrapped in `try/catch` — a Qdrant or embedding failure does not fail the ingest; the paper remains queryable via Postgres FTS only.

### QA / Summarization

```mermaid
flowchart TD
    A[User question] --> B{Cached kontext prompt?}
    B -->|hit| C[Use cached system prompt]
    B -->|miss| D[Fetch kontext.dev]
    D --> E[upsertKontextPrompt]
    D --> C

    C --> F[Hybrid retrieval over paper_chunks]
    F --> G[Collect citation + figure IDs from hits]
    G --> H[fetchPaperCitationsByPaperId / fetchPaperFiguresByPaperId]
    H --> I{Enrich with arXiv metadata?}
    I -->|yes| J[Fetch + cache]
    I -->|no| K[Use stored citation]
    J --> L[Build LLM context]
    K --> L
    F --> L

    L --> M[Call LLM]
    M --> N[upsertInteractions]
    M --> O[Return answer with citations]
```

### Kontext.dev cache

```mermaid
sequenceDiagram
    participant App
    participant Postgres
    participant KontextAPI

    App->>Postgres: getCachedKontextPrompt(userId, personaId, taskId, paperId)
    alt fresh row
        Postgres-->>App: systemPrompt
    else miss / expired
        App->>KontextAPI: POST /v1/context/get
        KontextAPI-->>App: systemPrompt
        App-->>App: respond using prompt
        App->>Postgres: upsertKontextPrompt (background)
    end
```

The lookup uses `IS NOT DISTINCT FROM` for the nullable `user_id`/`persona_id`/`paper_id` columns and respects `expires_at`.

## Operational notes

- **Schema migration**: `pnpm db:migrate` (idempotent). Also runs lazily on first DB access via memoized `ensureSchema()`.
- **Health check**: `pnpm test:stores` pings Postgres + Qdrant and ensures both the schema and the collection exist.
- **Local dev**: `docker compose up -d` starts both stores on default ports.
- **Connection pooling**: `pg.Pool` is cached on `globalThis` to survive Next.js dev hot reload; `statement_timeout` and `idle_timeout` are configurable via env (`POSTGRES_STATEMENT_TIMEOUT_MS`, `POSTGRES_IDLE_TIMEOUT_MS`).
- **Resilience**: Hybrid search degrades to FTS-only when embeddings or Qdrant are unreachable; ingest still records the paper in Postgres even if vector indexing fails.

## File map

- Schema (DDL): `src/server/db/schema.ts`
- Migration runner: `src/server/db/migrate.ts`, CLI `scripts/db-migrate.ts`
- Postgres client + pool: `src/server/db/postgres.ts`
- Repository functions: `src/server/db/papers.ts`, `src/server/db/persona.ts`
- Shared types: `src/server/db/types.ts`
- UUID helpers: `src/server/db/ids.ts`
- Qdrant client: `src/server/vector/qdrant.ts`
- Embeddings: `src/server/vector/embeddings.ts`
- Hybrid retriever: `src/server/search/hybrid.ts`
- Public facade: `src/server/repositories/index.ts`
- Health-check CLI: `scripts/test-stores.ts`
