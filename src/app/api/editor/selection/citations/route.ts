import { NextRequest, NextResponse } from 'next/server';

import { getSelectionCitations } from '@/server/editor/selection';

import { parseSelectionRequest } from '../utils';

export async function POST(request: NextRequest) {
  let payload: ReturnType<typeof parseSelectionRequest>;

  try {
    payload = parseSelectionRequest(await request.json());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid request payload.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await getSelectionCitations(
      payload.paperId,
      payload.selection,
    );

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[editor] Failed to fetch selection citations', error);
    const message =
      error instanceof Error ? error.message : 'Unable to fetch citations.';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
