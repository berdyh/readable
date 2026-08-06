import { NextRequest, NextResponse } from "next/server";

import { summarizeSelection } from "@/server/editor";
import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { parseLocalAgentPin } from "@/server/llm";
import { parseSelectionRequest } from "../utils";

function mapErrorStatus(error: unknown): number {
  if (error instanceof Error) {
    if (error.message.includes("OPENAI_API_KEY")) {
      return 500;
    }
    if (error.message.includes("OpenAI request failed")) {
      return 502;
    }
  }
  return 400;
}

export async function POST(request: NextRequest) {
  let payload: ReturnType<typeof parseSelectionRequest>;
  let localAgent: string | undefined;

  try {
    const data: unknown = await request.json();
    payload = parseSelectionRequest(data);
    localAgent = parseLocalAgentPin((data as Record<string, unknown>).localAgent);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const userId = await requireAuthenticatedUserId();
    const result = await summarizeSelection(payload.paperId, payload.selection, {
      localAgent,
      userId,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }
    console.error("[editor] Failed to summarize selection", error);
    const status = mapErrorStatus(error);
    const message = error instanceof Error ? error.message : "Unable to summarize selection.";
    return NextResponse.json({ error: message }, { status });
  }
}
