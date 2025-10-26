import { NextRequest, NextResponse } from 'next/server';

import { summarizePaper } from '@/server/summarize';

interface SummarizeRequestPayload {
  paperId: string;
  userId?: string;
  personaId?: string;
}

function parseRequestPayload(data: unknown): SummarizeRequestPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Request body must be an object.');
  }

  const payload = data as Record<string, unknown>;
  const paperIdRaw = payload.paperId;

  if (typeof paperIdRaw !== 'string' || !paperIdRaw.trim()) {
    throw new Error('Field "paperId" is required.');
  }

  const result: SummarizeRequestPayload = {
    paperId: paperIdRaw.trim(),
  };

  if (typeof payload.userId === 'string' && payload.userId.trim()) {
    result.userId = payload.userId.trim();
  }

  if (typeof payload.personaId === 'string' && payload.personaId.trim()) {
    result.personaId = payload.personaId.trim();
  }

  return result;
}

function mapErrorStatus(error: unknown): number {
  if (error instanceof Error) {
    if (error.message.includes('No content found')) {
      return 404;
    }
    if (error.message.includes('OPENAI_API_KEY')) {
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
    const message =
      error instanceof Error ? error.message : 'Invalid request payload.';
    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }

  try {
    const result = await summarizePaper(payload.paperId, {
      userId: payload.userId,
      personaId: payload.personaId,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[summarize] Failed to produce summary', error);
    const status = mapErrorStatus(error);
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to produce summary.';
    return NextResponse.json({ error: message }, { status });
  }
}
