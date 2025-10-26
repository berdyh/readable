import { NextRequest, NextResponse } from 'next/server';

import { answerPaperQuestion } from '@/server/qa';
import type { QuestionSelection } from '@/server/qa/types';
import { parseQuestionSelection } from '@/server/qa/selection';

interface QaRequestPayload {
  paperId: string;
  question: string;
  userId?: string;
  personaId?: string;
  selection?: QuestionSelection;
}

function parseRequestPayload(data: unknown): QaRequestPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Request body must be an object.');
  }

  const payload = data as Record<string, unknown>;
  const paperIdRaw = payload.paperId;
  const questionRaw = payload.question;

  if (typeof paperIdRaw !== 'string' || !paperIdRaw.trim()) {
    throw new Error('Field "paperId" is required.');
  }

  if (typeof questionRaw !== 'string' || !questionRaw.trim()) {
    throw new Error('Field "question" is required.');
  }

  const result: QaRequestPayload = {
    paperId: paperIdRaw.trim(),
    question: questionRaw.trim(),
  };

  if (typeof payload.userId === 'string' && payload.userId.trim()) {
    result.userId = payload.userId.trim();
  }

  if (typeof payload.personaId === 'string' && payload.personaId.trim()) {
    result.personaId = payload.personaId.trim();
  }

  const selection = parseQuestionSelection(payload.selection);
  if (selection) {
    result.selection = selection;
  }

  return result;
}

function mapErrorStatus(error: unknown): number {
  if (error instanceof Error) {
    if (error.message.includes('OpenAI request failed')) {
      return 502;
    }
    if (error.message.includes('OPENAI_API_KEY')) {
      return 500;
    }
  }
  return 502;
}

export async function POST(request: NextRequest) {
  let payload: QaRequestPayload;

  try {
    payload = parseRequestPayload(await request.json());
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Invalid request payload.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  try {
    const result = await answerPaperQuestion(payload.paperId, payload.question, {
      userId: payload.userId,
      personaId: payload.personaId,
      selection: payload.selection,
    });

    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error('[qa] Failed to answer question', error);
    const status = mapErrorStatus(error);
    const message =
      error instanceof Error
        ? error.message
        : 'Failed to answer the question.';
    return NextResponse.json({ error: message }, { status });
  }
}
