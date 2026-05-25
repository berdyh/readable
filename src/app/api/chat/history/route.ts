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

const CITATION_STRING_FIELDS = ["id", "title", "url", "chunkId", "quote"] as const;

class InvalidChatPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChatPayloadError";
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

  return message;
}

function toApiMessage(message: ChatMessageRecord): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    citations: parseCitations(message.citations),
    reasoning: message.reasoning,
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
