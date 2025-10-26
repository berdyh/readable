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
