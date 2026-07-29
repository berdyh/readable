import { NextRequest, NextResponse } from "next/server";

import { summarizeSelection } from "@/server/editor";
import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
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

  try {
    payload = parseSelectionRequest(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const userId = await requireAuthenticatedUserId();
    const result = await summarizeSelection(payload.paperId, payload.selection, {
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
