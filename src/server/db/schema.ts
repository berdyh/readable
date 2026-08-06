export const READABLE_SCHEMA_SQL = `
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

-- Semantic Scholar enrichment, persisted at ingest so the runtime
-- explanation path reads Postgres only. enriched_at marks when the row
-- was last enriched; NULL means never.
ALTER TABLE paper_citations ADD COLUMN IF NOT EXISTS abstract TEXT;
ALTER TABLE paper_citations ADD COLUMN IF NOT EXISTS arxiv_id TEXT;
ALTER TABLE paper_citations ADD COLUMN IF NOT EXISTS venue TEXT;
ALTER TABLE paper_citations ADD COLUMN IF NOT EXISTS citation_count INT;
ALTER TABLE paper_citations ADD COLUMN IF NOT EXISTS open_access_pdf_url TEXT;
ALTER TABLE paper_citations ADD COLUMN IF NOT EXISTS enriched_at TIMESTAMPTZ;

-- Global concept graph. concept_key is normalized and domain-faceted
-- ("{domain}:{key}") to avoid cross-field homonym merges.
CREATE TABLE IF NOT EXISTS concepts (
  concept_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS concept_edges (
  from_key TEXT NOT NULL REFERENCES concepts(concept_key) ON DELETE CASCADE,
  to_key TEXT NOT NULL REFERENCES concepts(concept_key) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT 'depends_on' CHECK (relation IN ('depends_on')),
  confidence DOUBLE PRECISION,
  source TEXT NOT NULL CHECK (source IN ('llm', 'citation')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (from_key, to_key, relation, source)
);
CREATE INDEX IF NOT EXISTS concept_edges_to_idx ON concept_edges(to_key);

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

-- Ledger evolution (additive). For ledger-evolved rows the concept
-- column stores the normalized concept_key (so UNIQUE(user_id, concept)
-- is the upsert target) and display_name carries the human name; legacy
-- rows keep their raw concept string and NULL display_name.
-- signal_counts is a JSONB map of typed signal -> count
-- (summary_exposure, selection_explained, qa_asked, explicit_confirmed).
-- known/new is derived at read time from weighted signals with time
-- decay — never stored.
ALTER TABLE persona_concepts ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE persona_concepts ADD COLUMN IF NOT EXISTS exposure_count INT NOT NULL DEFAULT 0;
ALTER TABLE persona_concepts ADD COLUMN IF NOT EXISTS distinct_paper_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE persona_concepts ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE persona_concepts ADD COLUMN IF NOT EXISTS signal_counts JSONB NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  interaction_type TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  chunk_ids TEXT[] NOT NULL DEFAULT '{}',
  -- Dual encoding by era: rows written before the concept-graph wave hold
  -- persona_concepts UUIDs; rows written after hold normalized concept keys
  -- ("ml:attention mechanism"). Nothing joins this column today — a future
  -- reader must handle both, or backfill first.
  persona_concept_ids TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS interactions_user_paper_idx
  ON interactions(user_id, paper_id);

CREATE TABLE IF NOT EXISTS chat_sessions (
  session_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, user_id, paper_id)
);
CREATE INDEX IF NOT EXISTS chat_sessions_user_paper_idx
  ON chat_sessions(user_id, paper_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
  session_id TEXT NOT NULL,
  id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  paper_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  citations JSONB,
  reasoning TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, id),
  FOREIGN KEY (session_id, user_id, paper_id)
    REFERENCES chat_sessions(session_id, user_id, paper_id)
    ON DELETE CASCADE
);
ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS metadata JSONB;
CREATE INDEX IF NOT EXISTS chat_messages_session_created_idx
  ON chat_messages(session_id, created_at);
`;
