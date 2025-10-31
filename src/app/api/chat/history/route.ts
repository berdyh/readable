import { NextRequest, NextResponse } from "next/server";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Array<{ id: string; title: string; url?: string; page?: number }>;
  reasoning?: string;
  createdAt: number;
}

interface ChatHistory {
  sessionId: string;
  paperId: string;
  userId: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

// In-memory store for chat history (in production, use a database)
// Key: sessionId, Value: ChatHistory
const chatHistoryStore = new Map<string, ChatHistory>();

/**
 * Get chat history for a session
 * GET /api/chat/history?sessionId=xxx
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("sessionId");
    const paperId = searchParams.get("paperId");
    const userId = searchParams.get("userId") || "default";

    if (sessionId) {
      // Get specific session
      const history = chatHistoryStore.get(sessionId);
      if (!history) {
        return NextResponse.json({ messages: [] }, { status: 200 });
      }
      return NextResponse.json({ messages: history.messages }, { status: 200 });
    }

    if (paperId) {
      // Get all sessions for a paper
      const sessions: Array<{
        sessionId: string;
        messages: ChatMessage[];
        createdAt: number;
        updatedAt: number;
      }> = [];

      for (const [id, history] of chatHistoryStore.entries()) {
        if (history.paperId === paperId && history.userId === userId) {
          sessions.push({
            sessionId: id,
            messages: history.messages,
            createdAt: history.createdAt,
            updatedAt: history.updatedAt,
          });
        }
      }

      // Sort by updatedAt descending (most recent first)
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);

      return NextResponse.json({ sessions }, { status: 200 });
    }

    return NextResponse.json(
      { error: "sessionId or paperId is required" },
      { status: 400 },
    );
  } catch (error) {
    console.error("[chat/history] Failed to get chat history", error);
    const message =
      error instanceof Error ? error.message : "Failed to get chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Save a chat message to a session
 * POST /api/chat/history
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sessionId?: string;
      paperId?: string;
      userId?: string;
      message?: ChatMessage;
      messages?: ChatMessage[];
    };

    const { sessionId, paperId, userId = "default", message, messages } = body;

    if (!sessionId || !paperId) {
      return NextResponse.json(
        { error: "sessionId and paperId are required" },
        { status: 400 },
      );
    }

    let history = chatHistoryStore.get(sessionId);

    if (!history) {
      // Create new session
      history = {
        sessionId,
        paperId,
        userId,
        messages: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      chatHistoryStore.set(sessionId, history);
    }

    // Add message(s) to history
    if (message) {
      history.messages.push(message);
    } else if (messages && Array.isArray(messages)) {
      history.messages.push(...messages);
    } else {
      return NextResponse.json(
        { error: "message or messages array is required" },
        { status: 400 },
      );
    }

    history.updatedAt = Date.now();

    return NextResponse.json(
      { success: true, messageCount: history.messages.length },
      { status: 200 },
    );
  } catch (error) {
    console.error("[chat/history] Failed to save chat history", error);
    const message =
      error instanceof Error ? error.message : "Failed to save chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Delete a chat session
 * DELETE /api/chat/history?sessionId=xxx
 */
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const sessionId = searchParams.get("sessionId");

    if (!sessionId) {
      return NextResponse.json(
        { error: "sessionId is required" },
        { status: 400 },
      );
    }

    const deleted = chatHistoryStore.delete(sessionId);

    return NextResponse.json(
      { success: true, deleted },
      { status: 200 },
    );
  } catch (error) {
    console.error("[chat/history] Failed to delete chat history", error);
    const message =
      error instanceof Error ? error.message : "Failed to delete chat history.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


