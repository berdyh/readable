import { NextResponse, type NextRequest } from 'next/server';

import { ingestPaper, type IngestRequest } from '@/server/ingest';

function sanitizeIngestPayload(data: unknown): IngestRequest {
  if (!data || typeof data !== 'object') {
    throw new Error('Request body must be a JSON object.');
  }

  const payload = data as Record<string, unknown>;
  const arxivIdRaw = payload.arxivId;

  if (typeof arxivIdRaw !== 'string' || !arxivIdRaw.trim()) {
    throw new Error('Field "arxivId" is required.');
  }

  const contactEmailRaw = payload.contactEmail;
  const forceOcrRaw = payload.forceOcr;

  const result: IngestRequest = {
    arxivId: arxivIdRaw.trim(),
  };

  if (typeof contactEmailRaw === 'string' && contactEmailRaw.trim()) {
    result.contactEmail = contactEmailRaw.trim();
  }

  if (typeof forceOcrRaw === 'boolean') {
    result.forceOcr = forceOcrRaw;
  }

  return result;
}

export async function POST(request: NextRequest) {
  let payload: IngestRequest;

  try {
    payload = sanitizeIngestPayload(await request.json());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid request payload.';
    return NextResponse.json(
      {
        error: message,
      },
      { status: 400 },
    );
  }

  try {
    const result = await ingestPaper(payload);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('[ingest] Failed to process request', error);
    const message =
      error instanceof Error ? error.message : 'Unexpected ingestion failure.';
    return NextResponse.json(
      {
        error: message,
      },
      { status: 502 },
    );
  }
}
