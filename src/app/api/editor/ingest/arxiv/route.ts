import { NextRequest, NextResponse } from "next/server";

import {
  InlineArxivIngestError,
  ingestArxivInline,
  normalizeArxivTarget,
} from "@/server/editor/ingest";

interface InlineArxivRequest {
  target: string;
}

const ARXIV_TARGET_ERROR_MESSAGE = "Enter an arXiv ID or arxiv.org/abs URL.";

function parseInlineArxivRequest(data: unknown): InlineArxivRequest {
  if (!data || typeof data !== "object") {
    throw new Error("Request body must be an object.");
  }

  const record = data as Record<string, unknown>;
  const targetRaw = record.target;

  if (typeof targetRaw !== "string" || !targetRaw.trim()) {
    throw new Error('Field "target" is required.');
  }

  const target = normalizeArxivTarget(targetRaw);
  if (!target) {
    throw new Error(ARXIV_TARGET_ERROR_MESSAGE);
  }

  return {
    target,
  };
}

function readErrorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("status" in error)) {
    return undefined;
  }

  const status = Number((error as { status?: unknown }).status);
  return Number.isFinite(status) ? status : undefined;
}

function classifyInlineArxivError(error: unknown): InlineArxivIngestError["code"] | undefined {
  if (error instanceof InlineArxivIngestError) {
    return error.code;
  }

  const status = readErrorStatus(error);
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lowerMessage = message.toLowerCase();

  if (
    status === 429 ||
    lowerMessage.includes("status 429") ||
    lowerMessage.includes("rate limit")
  ) {
    return "rate_limit";
  }

  if (
    status === 408 ||
    status === 504 ||
    name === "AbortError" ||
    lowerMessage.includes("status 408") ||
    lowerMessage.includes("status 504") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return "timeout";
  }

  if (status === 404 || lowerMessage.includes("status 404")) {
    return "not_found";
  }

  return undefined;
}

function toInlineArxivErrorResponse(error: unknown): { message: string; status: number } {
  switch (classifyInlineArxivError(error)) {
    case "invalid_target":
      return { message: ARXIV_TARGET_ERROR_MESSAGE, status: 400 };
    case "rate_limit":
      return { message: "arXiv is rate limiting requests. Try again later.", status: 429 };
    case "timeout":
      return { message: "arXiv request timed out. Try again later.", status: 504 };
    case "not_found":
      return { message: "No arXiv content was found for that target.", status: 404 };
    case "upstream_failure":
    default:
      return { message: "Unable to ingest arXiv content from the upstream source.", status: 502 };
  }
}

export async function POST(request: NextRequest) {
  let payload: InlineArxivRequest;

  try {
    payload = parseInlineArxivRequest(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await ingestArxivInline(payload.target);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("[editor] Failed to ingest arXiv content inline", error);
    const response = toInlineArxivErrorResponse(error);
    return NextResponse.json({ error: response.message }, { status: response.status });
  }
}
