import { NextRequest, NextResponse } from "next/server";

function generateSessionId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

/**
 * Create a new chat session
 * POST /api/chat/session
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { paperId, userId } = body as { paperId?: string; userId?: string };

    if (!paperId) {
      return NextResponse.json(
        { error: "paperId is required" },
        { status: 400 },
      );
    }

    // Create a new chat session ID
    const sessionId = generateSessionId();

    // Store session metadata (in a real app, this would be in a database)
    const session = {
      id: sessionId,
      paperId,
      userId: userId || "default",
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json({ session }, { status: 200 });
  } catch (error) {
    console.error("[chat/session] Failed to create session", error);
    const message =
      error instanceof Error ? error.message : "Failed to create chat session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

