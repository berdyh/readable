import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth/user";
import {
  ChatSessionOwnershipError,
  deleteChatSession,
  getChatMessagesForSession,
  listChatSessionsForPaper,
  saveChatMessages,
} from "@/server/db";
import type { ChatMessageRecord } from "@/server/db";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: ChatCitation[];
  reasoning?: string;
  metadata?: ChatMessageMetadata;
  createdAt: number;
}

interface ChatCitation {
  id?: string;
  title?: string;
  url?: string;
  page?: number;
  chunkId?: string;
  quote?: string;
}

interface ChatMessageMetadata {
  version: 1;
  trust: ChatTrustMetadata;
}

interface ChatTrustMetadata {
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

type ChatTrustStatus = "sourced" | "uncited" | "refused" | "unavailable" | "unknown";
type ChatVectorRetrievalStatus =
  | "ok"
  | "skipped"
  | "embedding_failed"
  | "search_failed"
  | "unavailable"
  | "unknown";
type ChatTextRetrievalStatus = "ok" | "empty" | "unavailable" | "unknown";

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

type ChatMessageRecordWithMetadata = ChatMessageRecord & {
  metadata?: unknown;
};

class InvalidChatPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChatPayloadError";
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedJsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function sanitizeCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.min(MAX_METADATA_COUNT, Math.floor(value));
}

function sanitizeWarnings(value: unknown): string[] {
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

function sanitizeReason(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const reason = value.trim().slice(0, MAX_METADATA_REASON_LENGTH);
  return reason || undefined;
}

function parseChatMetadata(value: unknown): ChatMessageMetadata {
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

function legacyAssistantMetadata(): ChatMessageMetadata {
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

function parsePersistedChatMetadata(
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

function parseCitations(value: unknown): ChatCitation[] | undefined {
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

function parseChatMessage(value: unknown): ChatMessage {
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

function toApiMessage(message: ChatMessageRecord): ChatMessage {
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

/**
 * Get chat history for a session or all sessions for a paper.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await requireAuthenticatedUserId();
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("sessionId")?.trim();
    const paperId = searchParams.get("paperId")?.trim();

    if (sessionId) {
      const messages = await getChatMessagesForSession(userId, sessionId);
      return NextResponse.json({ messages: messages.map(toApiMessage) }, { status: 200 });
    }

    if (paperId) {
      const sessions = await listChatSessionsForPaper(userId, paperId);
      return NextResponse.json(
        {
          sessions: sessions.map((session) => ({
            sessionId: session.sessionId,
            messages: session.messages.map(toApiMessage),
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
          })),
        },
        { status: 200 },
      );
    }

    return NextResponse.json({ error: "sessionId or paperId is required" }, { status: 400 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }

    console.error("[chat/history] Failed to get chat history", error);
    const message = error instanceof Error ? error.message : "Failed to get chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Save a chat message to a session.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = await requireAuthenticatedUserId();
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      paperId?: string;
      message?: unknown;
      messages?: unknown[];
    };

    const sessionId = body.sessionId?.trim();
    const paperId = body.paperId?.trim();

    if (!sessionId || !paperId) {
      return NextResponse.json({ error: "sessionId and paperId are required" }, { status: 400 });
    }

    const messages = body.message
      ? [parseChatMessage(body.message)]
      : Array.isArray(body.messages)
        ? body.messages.map(parseChatMessage)
        : [];

    if (messages.length === 0) {
      return NextResponse.json({ error: "message or messages array is required" }, { status: 400 });
    }

    const messageCount = await saveChatMessages(userId, paperId, sessionId, messages);

    return NextResponse.json({ success: true, messageCount }, { status: 200 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }
    if (error instanceof ChatSessionOwnershipError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof InvalidChatPayloadError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error("[chat/history] Failed to save chat history", error);
    const message = error instanceof Error ? error.message : "Failed to save chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Delete a chat session.
 */
export async function DELETE(request: NextRequest) {
  try {
    const userId = await requireAuthenticatedUserId();
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("sessionId")?.trim();

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }

    const deleted = await deleteChatSession(userId, sessionId);

    return NextResponse.json({ success: true, deleted }, { status: 200 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }

    console.error("[chat/history] Failed to delete chat history", error);
    const message = error instanceof Error ? error.message : "Failed to delete chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
