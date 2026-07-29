import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { InvalidChatPayloadError, parseChatMessage, toApiMessage } from "@/server/chat";
import {
  ChatSessionOwnershipError,
  deleteChatSession,
  getChatMessagesForSession,
  listChatSessionsForPaper,
  saveChatMessages,
} from "@/server/db";

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
