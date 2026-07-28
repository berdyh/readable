export type ChatTrustStatus = "sourced" | "uncited" | "refused" | "unavailable" | "unknown";

export type ChatVectorRetrievalStatus =
  | "ok"
  | "skipped"
  | "embedding_failed"
  | "search_failed"
  | "unavailable"
  | "unknown";

export type ChatTextRetrievalStatus = "ok" | "empty" | "unavailable" | "unknown";

export interface ChatCitation {
  id?: string;
  title?: string;
  url?: string;
  page?: number;
  chunkId?: string;
  quote?: string;
}

export interface ChatTrustMetadata {
  status: ChatTrustStatus;
  hasEvidence: boolean;
  validCitationCount: number;
  invalidCitationCount: number;
  warnings: string[];
  retrieval: {
    vector: {
      status: ChatVectorRetrievalStatus;
      hitCount: number;
      reason?: string;
    };
    text: {
      status: ChatTextRetrievalStatus;
      hitCount: number;
    };
  };
}

export interface ChatMessageMetadata {
  version: 1;
  trust: ChatTrustMetadata;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  reasoning?: string;
  metadata?: ChatMessageMetadata;
  createdAt: number;
}
