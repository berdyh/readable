import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { recordExposureSignal } from "@/server/persona";

const MAX_CONCEPTS = 12;

interface ExposurePayload {
  paperId: string;
  concepts: Array<{ concept: string; domain?: string; description?: string }>;
}

function parsePayload(data: unknown): ExposurePayload {
  if (!data || typeof data !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const record = data as Record<string, unknown>;
  const paperId = typeof record.paperId === "string" ? record.paperId.trim() : "";
  if (!paperId) {
    throw new Error("paperId is required.");
  }

  if (!Array.isArray(record.concepts)) {
    throw new Error("concepts must be an array.");
  }

  const concepts = record.concepts
    .slice(0, MAX_CONCEPTS)
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }
      const conceptRecord = entry as Record<string, unknown>;
      const concept =
        typeof conceptRecord.concept === "string" ? conceptRecord.concept.trim() : "";
      if (!concept) {
        return undefined;
      }
      return {
        concept,
        domain: typeof conceptRecord.domain === "string" ? conceptRecord.domain : undefined,
        description:
          typeof conceptRecord.description === "string" ? conceptRecord.description : undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (concepts.length === 0) {
    throw new Error("concepts must include at least one named concept.");
  }

  return { paperId, concepts };
}

/**
 * Render-gated exposure recording: the reader surface calls this when
 * explanation-contract content actually renders — never for an unseen
 * auto-generated summary. Records summary_exposure ledger signals for
 * the signed-in reader.
 */
export async function POST(request: NextRequest) {
  let payload: ExposurePayload;
  try {
    payload = parsePayload(await request.json());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request payload.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const userId = await requireAuthenticatedUserId();
    await recordExposureSignal({
      userId,
      paperId: payload.paperId,
      concepts: payload.concepts,
    });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }
    console.error("[persona] Failed to record exposure", error);
    return NextResponse.json({ error: "Failed to record exposure." }, { status: 500 });
  }
}
