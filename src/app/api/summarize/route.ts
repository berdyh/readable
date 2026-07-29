import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { summarizePaper } from "@/server/summarize";

interface SummarizeRequestPayload {
  paperId: string;
}

function parseRequestPayload(data: unknown): SummarizeRequestPayload {
  if (!data || typeof data !== "object") {
    throw new Error("Request body must be an object.");
  }

  const payload = data as Record<string, unknown>;
  const paperIdRaw = payload.paperId;

  if (typeof paperIdRaw !== "string" || !paperIdRaw.trim()) {
    throw new Error('Field "paperId" is required.');
  }

  const result: SummarizeRequestPayload = {
    paperId: paperIdRaw.trim(),
  };

  return result;
}

function mapErrorStatus(error: unknown): number {
  if (error instanceof Error) {
    if (error.message.includes("No content found")) {
      return 404;
    }
    if (error.message.includes("OPENAI_API_KEY")) {
      return 500;
    }
  }
  return 502;
}

export async function POST(request: NextRequest) {
  let payload: SummarizeRequestPayload;

  try {
    payload = parseRequestPayload(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const userId = await requireAuthenticatedUserId();
    const result = await summarizePaper(payload.paperId, {
      userId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }
    console.error("[summarize] Failed to produce summary", error);
    const status = mapErrorStatus(error);
    const message = error instanceof Error ? error.message : "Failed to produce summary.";
    return NextResponse.json({ error: message }, { status });
  }
}
