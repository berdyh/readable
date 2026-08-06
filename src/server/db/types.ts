export interface PaperRecord {
  paperId: string;
  title?: string;
  abstract?: string;
  authors: string[];
  primaryCategory?: string;
  categories: string[];
  publishedAt?: string;
  updatedAt?: string;
  pdfUrl?: string;
  pages?: number;
}

export interface PaperChunk {
  id?: string;
  paperId: string;
  chunkId: string;
  text: string;
  section?: string;
  pageNumber?: number;
  tokenStart?: number;
  tokenEnd?: number;
  citations?: string[];
  figureIds?: string[];
}

export interface Figure {
  id?: string;
  paperId: string;
  figureId: string;
  caption: string;
  pageNumber?: number;
  imageUrl?: string;
  chunkIds?: string[];
}

export interface Citation {
  id?: string;
  paperId: string;
  citationId: string;
  title?: string;
  authors?: string[];
  year?: number;
  source?: string;
  doi?: string;
  url?: string;
  chunkIds?: string[];
  /** Semantic Scholar enrichment, persisted at ingest. */
  abstract?: string;
  arxivId?: string;
  venue?: string;
  citationCount?: number;
  openAccessPdfUrl?: string;
  /** When the row was last enriched; undefined means never. */
  enrichedAt?: string;
}

/** Typed persona signals. Weights live in server/explain, not here. */
export type ConceptSignalType =
  | "summary_exposure"
  | "selection_explained"
  | "qa_asked"
  | "explicit_confirmed";

/** Global concept-graph node, keyed by normalized "{domain}:{key}". */
export interface ConceptRecord {
  conceptKey: string;
  displayName: string;
  description?: string;
}

/**
 * The concept-graph enums, declared once as values so the read path can
 * check a database string against them instead of hard-coding a literal.
 * Both lists mirror a CHECK constraint in `schema.ts`, and `schema.test.ts`
 * asserts they still agree — widening one without the other fails there,
 * loudly, instead of being silently discarded on read.
 */
export const CONCEPT_EDGE_RELATIONS = ["depends_on"] as const;
export type ConceptEdgeRelation = (typeof CONCEPT_EDGE_RELATIONS)[number];

export const CONCEPT_EDGE_SOURCES = ["llm", "citation"] as const;
export type ConceptEdgeSource = (typeof CONCEPT_EDGE_SOURCES)[number];

export interface ConceptEdgeRecord {
  fromKey: string;
  toKey: string;
  relation?: ConceptEdgeRelation;
  confidence?: number;
  source: ConceptEdgeSource;
}

/**
 * Read shape: an edge plus the provenance the write path recorded.
 * `paperIds` is empty for pre-provenance rows — absence of evidence, not
 * evidence of a single source.
 */
export interface ConceptEdgeWithProvenance extends ConceptEdgeRecord {
  paperIds: string[];
  /**
   * Whether the edge is worth trusting without a human: read out of cited
   * text, or asserted independently by at least two papers. A future read
   * path should rank or filter on this rather than on raw confidence,
   * which is self-reported by the model that produced the edge.
   */
  corroborated: boolean;
}

/** Per-user mastery ledger row (evolved persona_concepts). */
export interface ConceptLedgerEntry {
  userId: string;
  conceptKey: string;
  displayName?: string;
  description?: string;
  exposureCount: number;
  distinctPaperIds: string[];
  lastSeenAt?: string;
  signalCounts: Partial<Record<ConceptSignalType, number>>;
}

export interface PersonaConcept {
  id?: string;
  userId: string;
  concept: string;
  description?: string;
  firstSeenPaperId?: string;
  learnedAt?: string;
  confidence?: number;
}

export interface Interaction {
  id?: string;
  userId: string;
  paperId: string;
  interactionType: string;
  prompt: string;
  response?: string;
  createdAt?: string;
  chunkIds?: string[];
  personaConceptIds?: string[];
}

export interface ChatMessageRecord {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: unknown[];
  reasoning?: string;
  metadata?: unknown;
  createdAt: number;
}

export interface ChatSessionRecord {
  sessionId: string;
  paperId: string;
  userId: string;
  messages: ChatMessageRecord[];
  createdAt: number;
  updatedAt: number;
}
