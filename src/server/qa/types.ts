export interface QuestionSelection {
  text?: string;
  page?: number;
  section?: string;
}

export interface QuestionOptions {
  userId?: string;
  selection?: QuestionSelection;
  alpha?: number;
  limit?: number;
}

export interface QaChunkContext {
  id: string;
  chunkId: string;
  text: string;
  section?: string;
  pageNumber?: number;
  score?: number;
  distance?: number;
  citations: string[];
  figureIds: string[];
}

export interface QaFigureContext {
  figureId: string;
  caption: string;
  pageNumber?: number;
  imageUrl?: string;
}

export interface QaCitationContext {
  citationId: string;
  title?: string;
  authors?: string[];
  year?: number;
  source?: string;
  doi?: string;
  url?: string;
  arxivId?: string;
  abstract?: string;
}

export interface NormalizedSelection {
  text?: string;
  page?: number;
  section?: string;
}

export interface QuestionEvidenceContext {
  paperId: string;
  query: string;
  hits: QaChunkContext[];
  expandedWindow: QaChunkContext[];
  figures: QaFigureContext[];
  citations: QaCitationContext[];
  retrieval?: QaRetrievalDiagnostics;
  selection?: NormalizedSelection;
}

export interface AnswerCitation {
  chunkId: string;
  page?: number;
  quote?: string;
  sourceAvailable?: boolean;
}

export type QaVectorRetrievalStatus = "ok" | "skipped" | "embedding_failed" | "search_failed";

export type QaTextRetrievalStatus = "ok" | "empty";

export interface QaRetrievalDiagnostics {
  vector: {
    status: QaVectorRetrievalStatus;
    hitCount: number;
    reason?: string;
  };
  text: {
    status: QaTextRetrievalStatus;
    hitCount: number;
  };
}

export type AnswerTrustStatus = "sourced" | "uncited" | "refused";

export interface AnswerTrustMetadata {
  status: AnswerTrustStatus;
  hasEvidence: boolean;
  validCitationCount: number;
  invalidCitationCount: number;
  warnings: string[];
  retrieval: QaRetrievalDiagnostics;
}

export interface AnswerResult {
  answer: string;
  cites: AnswerCitation[];
  trust: AnswerTrustMetadata;
}
