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
