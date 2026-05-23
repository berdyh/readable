import { NextResponse } from 'next/server';

import { listPersonaConceptsForUser } from '@/server/db';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ userId: string }>;
}

export async function GET(_req: Request, ctx: RouteContext) {
  try {
    const { userId } = await ctx.params;
    if (!userId || !userId.trim()) {
      return NextResponse.json(
        { error: 'userId is required.' },
        { status: 400 },
      );
    }

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
    const message =
      error instanceof Error ? error.message : 'Unknown error.';
    console.error('[api/skills] failed:', message);
    return NextResponse.json(
      { error: 'Failed to load skills.' },
      { status: 500 },
    );
  }
}
