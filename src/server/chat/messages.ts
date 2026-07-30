import type { ChatMessageRecord } from "@/server/db/types";

import type {
  ChatCitation,
  ChatMessage,
  ChatMessageMetadata,
  ChatSourceLabel,
  ChatTextRetrievalStatus,
  ChatTrustStatus,
  ChatVectorRetrievalStatus,
} from "./types";

const CITATION_STRING_FIELDS = ["id", "title", "url", "chunkId", "quote"] as const;
const MAX_METADATA_BYTES = 8192;
const MAX_METADATA_WARNINGS = 8;
const MAX_METADATA_WARNING_LENGTH = 240;
const MAX_METADATA_REASON_LENGTH = 500;
const MAX_METADATA_COUNT = 10_000;
const TRUST_STATUSES = new Set<ChatTrustStatus>([
  "sourced",
  "uncited",
  "refused",
  "unavailable",
  "unknown",
]);
const VECTOR_RETRIEVAL_STATUSES = new Set<ChatVectorRetrievalStatus>([
  "ok",
  "skipped",
  "embedding_failed",
  "search_failed",
  "unavailable",
  "unknown",
]);
const TEXT_RETRIEVAL_STATUSES = new Set<ChatTextRetrievalStatus>([
  "ok",
  "empty",
  "unavailable",
  "unknown",
]);
const SOURCE_LABELS = new Set<ChatSourceLabel>(["model_knowledge", "cited_text"]);

function sanitizeSourceLabel(value: unknown): ChatSourceLabel | undefined {
  return SOURCE_LABELS.has(value as ChatSourceLabel) ? (value as ChatSourceLabel) : undefined;
}

type ChatMessageRecordWithMetadata = ChatMessageRecord & {
  metadata?: unknown;
};

export class InvalidChatPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChatPayloadError";
  }
}

export function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function boundedJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function sanitizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(MAX_METADATA_COUNT, Math.floor(value));
}

export function sanitizeWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, MAX_METADATA_WARNINGS)
    .map((entry) => entry.slice(0, MAX_METADATA_WARNING_LENGTH));
}

export function sanitizeReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const reason = value.trim().slice(0, MAX_METADATA_REASON_LENGTH);
  return reason || undefined;
}

export function parseChatMetadata(value: unknown): ChatMessageMetadata {
  if (!isObjectRecord(value)) {
    throw new InvalidChatPayloadError("Chat message metadata must be an object.");
  }
  if (boundedJsonByteLength(value) > MAX_METADATA_BYTES) {
    throw new InvalidChatPayloadError("Chat message metadata is too large.");
  }

  if (value.version !== undefined && value.version !== 1) {
    throw new InvalidChatPayloadError("Chat message metadata version is unsupported.");
  }

  if (!isObjectRecord(value.trust)) {
    throw new InvalidChatPayloadError("Chat message metadata trust must be an object.");
  }

  const trust = value.trust;
  const status = TRUST_STATUSES.has(trust.status as ChatTrustStatus)
    ? (trust.status as ChatTrustStatus)
    : "unknown";
  const retrieval = isObjectRecord(trust.retrieval) ? trust.retrieval : {};
  const vector = isObjectRecord(retrieval.vector) ? retrieval.vector : {};
  const text = isObjectRecord(retrieval.text) ? retrieval.text : {};
  const vectorStatus = VECTOR_RETRIEVAL_STATUSES.has(vector.status as ChatVectorRetrievalStatus)
    ? (vector.status as ChatVectorRetrievalStatus)
    : "unknown";
  const textStatus = TEXT_RETRIEVAL_STATUSES.has(text.status as ChatTextRetrievalStatus)
    ? (text.status as ChatTextRetrievalStatus)
    : "unknown";

  return {
    version: 1,
    trust: {
      status,
      hasEvidence: trust.hasEvidence === true,
      validCitationCount: sanitizeCount(trust.validCitationCount),
      invalidCitationCount: sanitizeCount(trust.invalidCitationCount),
      warnings: sanitizeWarnings(trust.warnings),
      source: sanitizeSourceLabel(trust.source),
      retrieval: {
        vector: {
          status: vectorStatus,
          hitCount: sanitizeCount(vector.hitCount),
          reason: sanitizeReason(vector.reason),
        },
        text: {
          status: textStatus,
          hitCount: sanitizeCount(text.hitCount),
        },
      },
    },
  };
}

export function legacyAssistantMetadata(): ChatMessageMetadata {
  return {
    version: 1,
    trust: {
      status: "unavailable",
      hasEvidence: false,
      validCitationCount: 0,
      invalidCitationCount: 0,
      warnings: ["Answer trust metadata was not captured for this legacy message."],
      retrieval: {
        vector: {
          status: "unavailable",
          hitCount: 0,
          reason: "legacy_message",
        },
        text: {
          status: "unavailable",
          hitCount: 0,
        },
      },
    },
  };
}

export function parsePersistedChatMetadata(
  value: unknown,
  role: ChatMessage["role"],
): ChatMessageMetadata | undefined {
  if (role !== "assistant") {
    return undefined;
  }
  if (value === undefined || value === null) {
    return legacyAssistantMetadata();
  }
  try {
    return parseChatMetadata(value);
  } catch {
    return legacyAssistantMetadata();
  }
}

export function parseCitations(value: unknown): ChatCitation[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new InvalidChatPayloadError("Chat message citations must be an array.");
  }

  return value.map((entry) => {
    if (!entry || typeof entry !== "object") {
      throw new InvalidChatPayloadError("Chat message citation entries must be objects.");
    }

    const record = entry as Record<string, unknown>;
    const citation: ChatCitation = {};
    for (const field of CITATION_STRING_FIELDS) {
      if (typeof record[field] === "string" && record[field].trim()) {
        citation[field] = record[field].trim();
      }
    }
    if (typeof record.page === "number" && Number.isFinite(record.page)) {
      citation.page = record.page;
    }

    if (Object.keys(citation).length === 0) {
      throw new InvalidChatPayloadError(
        "Chat message citation entries must include citation metadata.",
      );
    }

    return citation;
  });
}

export function parseChatMessage(value: unknown): ChatMessage {
  if (!value || typeof value !== "object") {
    throw new InvalidChatPayloadError("Chat message must be an object.");
  }

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const role = record.role;
  const content = typeof record.content === "string" ? record.content.trim() : "";
  const createdAt =
    typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : Date.now();

  if (!id) {
    throw new InvalidChatPayloadError("Chat message id is required.");
  }
  if (role !== "user" && role !== "assistant") {
    throw new InvalidChatPayloadError('Chat message role must be "user" or "assistant".');
  }
  if (!content) {
    throw new InvalidChatPayloadError("Chat message content is required.");
  }

  const message: ChatMessage = {
    id,
    role,
    content,
    createdAt,
  };

  message.citations = parseCitations(record.citations);
  if (typeof record.reasoning === "string" && record.reasoning.trim()) {
    message.reasoning = record.reasoning.trim();
  }
  if (role === "assistant" && record.metadata !== undefined) {
    message.metadata = parseChatMetadata(record.metadata);
  }

  return message;
}

export function toApiMessage(message: ChatMessageRecord): ChatMessage {
  const messageWithMetadata = message as ChatMessageRecordWithMetadata;
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: parseCitations(message.citations),
    reasoning: message.reasoning,
    metadata: parsePersistedChatMetadata(messageWithMetadata.metadata, message.role),
    createdAt: message.createdAt,
  };
}
