import { NextResponse } from "next/server";

import {
  AUTH_REQUIRED_MESSAGE,
  isAuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth/user";
import { listPersonaConceptsForUser } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireAuthenticatedUserId();
    const concepts = await listPersonaConceptsForUser(userId, 200);

    return NextResponse.json({
      userId,
      total: concepts.length,
      concepts: concepts.map((entry) => ({
        concept: entry.concept,
        description: entry.description,
        firstSeenPaperId: entry.firstSeenPaperId,
        learnedAt: entry.learnedAt,
        confidence: entry.confidence,
      })),
    });
  } catch (error) {
    if (isAuthenticationRequiredError(error)) {
      return NextResponse.json({ error: AUTH_REQUIRED_MESSAGE }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : "Unknown error.";
    console.error("[api/skills] failed:", message);
    return NextResponse.json({ error: "Failed to load skills." }, { status: 500 });
  }
}
