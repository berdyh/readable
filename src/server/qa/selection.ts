import type { QuestionSelection } from './types';

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export function parseQuestionSelection(
  value: unknown,
): QuestionSelection | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const selection: QuestionSelection = {};

  const text = normalizeText(record.text);
  if (text) {
    selection.text = text;
  }

  const section = normalizeText(record.section);
  if (section) {
    selection.section = section;
  }

  const pageRaw = record.page;
  if (typeof pageRaw === 'number' && Number.isFinite(pageRaw)) {
    selection.page = pageRaw;
  } else if (typeof pageRaw === 'string') {
    const parsed = Number(pageRaw);
    if (Number.isFinite(parsed)) {
      selection.page = parsed;
    }
  }

  if (!selection.text && !selection.section && selection.page === undefined) {
    return undefined;
  }

  return selection;
}
