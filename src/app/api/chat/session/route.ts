import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { createChatSession } from "@/server/db";

function generateSessionId(): string {
  return `chat_${Date.now()}_${randomUUID()}`;
}

/**
 * Create a new chat session
 * POST /api/chat/session
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { paperId } = body as { paperId?: string };
    const userId = await requireAuthenticatedUserId();
    const resolvedPaperId = paperId?.trim();

    if (!resolvedPaperId) {
      return NextResponse.json({ error: "paperId is required" }, { status: 400 });
    }

    const sessionId = generateSessionId();
    const createdSession = await createChatSession(userId, resolvedPaperId, sessionId);
    const session = {
      id: createdSession.sessionId,
      paperId: createdSession.paperId,
      createdAt: new Date(createdSession.createdAt).toISOString(),
    };

    return NextResponse.json({ session }, { status: 200 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }

    console.error("[chat/session] Failed to create session", error);
    const message = error instanceof Error ? error.message : "Failed to create chat session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
