import { NextRequest, NextResponse } from 'next/server';

import { ingestArxivInline } from '@/server/editor/ingest';

interface InlineArxivRequest {
  target: string;
}

function parseInlineArxivRequest(data: unknown): InlineArxivRequest {
  if (!data || typeof data !== 'object') {
    throw new Error('Request body must be an object.');
  }

  const record = data as Record<string, unknown>;
  const targetRaw = record.target;

  if (typeof targetRaw !== 'string' || !targetRaw.trim()) {
    throw new Error('Field "target" is required.');
  }

  return {
    target: targetRaw.trim(),
  };
}

export async function POST(request: NextRequest) {
  let payload: InlineArxivRequest;

  try {
    payload = parseInlineArxivRequest(await request.json());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid request payload.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await ingestArxivInline(payload.target);
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[editor] Failed to ingest arXiv content inline', error);
    const message =
      error instanceof Error ? error.message : 'Unable to ingest arXiv content.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
