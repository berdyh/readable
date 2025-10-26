import { parseQuestionSelection } from '@/server/qa/selection';
import type { QuestionSelection } from '@/server/qa/types';

export interface SelectionRequestPayload {
  paperId: string;
  selection: QuestionSelection;
  userId?: string;
  personaId?: string;
}

export function parseSelectionRequest(data: unknown): SelectionRequestPayload {
  if (!data || typeof data !== 'object') {
    throw new Error('Request body must be an object.');
  }

  const record = data as Record<string, unknown>;
  const paperIdRaw = record.paperId;

  if (typeof paperIdRaw !== 'string' || !paperIdRaw.trim()) {
    throw new Error('Field "paperId" is required.');
  }

  const selection = parseQuestionSelection(record.selection);
  if (!selection) {
    throw new Error(
      'Field "selection" must include text, section, or page metadata.',
    );
  }

  const payload: SelectionRequestPayload = {
    paperId: paperIdRaw.trim(),
    selection,
  };

  if (typeof record.userId === 'string' && record.userId.trim()) {
    payload.userId = record.userId.trim();
  }

  if (typeof record.personaId === 'string' && record.personaId.trim()) {
    payload.personaId = record.personaId.trim();
  }

  return payload;
}
