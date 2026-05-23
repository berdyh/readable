-- Readable schema for Postgres.
-- Source of truth for paper content, citations, figures, and persona state.
-- Vector retrieval lives in Qdrant; text-search ranking uses the GIN index
-- on the generated tsvector column below.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS papers (
  paper_id TEXT PRIMARY KEY,
  title TEXT,
  abstract TEXT,
  authors TEXT[] NOT NULL DEFAULT '{}',
  primary_category TEXT,
  categories TEXT[] NOT NULL DEFAULT '{}',
  published_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  pdf_url TEXT,
  pages INT,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paper_chunks (
  id UUID PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
  chunk_id TEXT NOT NULL,
  text TEXT NOT NULL,
  section TEXT,
  page_number INT,
  token_start INT,
  token_end INT,
  citations TEXT[] NOT NULL DEFAULT '{}',
  figure_ids TEXT[] NOT NULL DEFAULT '{}',
  text_search tsvector GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (paper_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS paper_chunks_paper_idx ON paper_chunks(paper_id);
CREATE INDEX IF NOT EXISTS paper_chunks_text_idx ON paper_chunks USING GIN(text_search);

CREATE TABLE IF NOT EXISTS paper_figures (
  id UUID PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
  figure_id TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  page_number INT,
  image_url TEXT,
  chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (paper_id, figure_id)
);
CREATE INDEX IF NOT EXISTS paper_figures_paper_idx ON paper_figures(paper_id);

CREATE TABLE IF NOT EXISTS paper_citations (
  id UUID PRIMARY KEY,
  paper_id TEXT NOT NULL REFERENCES papers(paper_id) ON DELETE CASCADE,
  citation_id TEXT NOT NULL,
  title TEXT,
  authors TEXT[] NOT NULL DEFAULT '{}',
  year INT,
  source TEXT,
  doi TEXT,
  url TEXT,
  chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  UNIQUE (paper_id, citation_id)
);
CREATE INDEX IF NOT EXISTS paper_citations_paper_idx ON paper_citations(paper_id);

CREATE TABLE IF NOT EXISTS persona_concepts (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  description TEXT,
  first_seen_paper_id TEXT,
  learned_at TIMESTAMPTZ,
  confidence DOUBLE PRECISION,
  UNIQUE (user_id, concept)
);
CREATE INDEX IF NOT EXISTS persona_concepts_user_idx ON persona_concepts(user_id);

CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  persona_concept_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interactions_user_paper_idx
  ON interactions(user_id, paper_id);

-- Kontext prompt cache was removed when the Kontext.dev integration was
-- dropped. Existing deployments can drop the table:
--   DROP TABLE IF EXISTS kontext_prompts;
-- The schema bootstrap below is idempotent and won't recreate it.
