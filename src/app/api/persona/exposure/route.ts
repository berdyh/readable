import { NextRequest, NextResponse } from "next/server";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { recordExposureSignal } from "@/server/persona";

import { parseExposurePayload, type ExposurePayload } from "./parsePayload";

/**
 * Render-gated exposure recording: the reader surface calls this when
 * explanation-contract content actually renders — never for an unseen
 * auto-generated summary. Records summary_exposure ledger signals for
 * the signed-in reader.
 */
export async function POST(request: NextRequest) {
  let payload: ExposurePayload;
  try {
    payload = parseExposurePayload(await request.json());
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
