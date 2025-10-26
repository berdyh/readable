export interface QuestionSelection {
  text?: string;
  page?: number;
  section?: string;
}

export interface QuestionOptions {
  userId?: string;
  personaId?: string;
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
  selection?: NormalizedSelection;
}

export interface AnswerCitation {
  chunkId: string;
  page?: number;
  quote?: string;
}

export interface AnswerResult {
  answer: string;
  cites: AnswerCitation[];
}
