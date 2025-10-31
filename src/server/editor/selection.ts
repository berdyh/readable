import { loadQuestionEvidence } from '@/server/qa/context';
import { parseQuestionSelection } from '@/server/qa/selection';
import type {
  AnswerCitation,
  QuestionSelection,
  QuestionEvidenceContext,
} from '@/server/qa/types';
import { generateJson } from '@/server/llm';
import { fetchKontextSystemPrompt } from '@/server/summarize/kontext';

import type {
  SelectionCalloutResult,
  SelectionCitationsResult,
  SelectionFiguresResult,
  SelectionSummaryResult,
  SelectionSummaryBullet,
} from './types';

import { getSystemPrompt } from '@/server/llm-config';

const SELECTION_SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['bullets', 'more', 'citations'],
  properties: {
    bullets: {
      type: 'array',
      minItems: 2,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'citation_ids'],
        properties: {
          text: { type: 'string', minLength: 1 },
          citation_ids: {
            type: 'array',
            minItems: 1,
            items: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    more: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: { type: 'string', minLength: 1 },
    },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['chunk_id'],
        properties: {
          chunk_id: { type: 'string', minLength: 1 },
          page: { type: 'integer' },
          quote: { type: 'string' },
        },
      },
    },
  },
};

interface LlmSummaryBullet {
  text?: string;
  citation_ids?: string[];
}

interface LlmSummaryPayload {
  bullets?: LlmSummaryBullet[];
  more?: string[];
  citations?: Array<{
    chunk_id?: string;
    page?: number;
    quote?: string;
  }>;
}

function truncate(text: string, max = 420): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 1)}…`;
}

function buildChunkSummary(
  chunk: QuestionEvidenceContext['hits'][number],
  index: number,
): string {
  const headerParts = [`[chunk_id=${chunk.chunkId}]`];
  if (chunk.section) {
    headerParts.push(`section: ${chunk.section}`);
  }
  if (typeof chunk.pageNumber === 'number') {
    headerParts.push(`page: ${chunk.pageNumber}`);
  }
  const header = `Chunk ${index + 1}: ${headerParts.join(' · ')}`;
  const body = truncate(chunk.text.replace(/\s+/g, ' ').trim(), 520);
  return `${header}\n${body}`;
}

function buildSelectionUserPrompt(
  paperId: string,
  selection: QuestionSelection,
  evidence: QuestionEvidenceContext,
): string {
  const lines: string[] = [];

  lines.push(`Paper ID: ${paperId}`);
  if (selection.text) {
    lines.push(`Highlighted text: “${truncate(selection.text, 420)}”`);
  }
  if (selection.section) {
    lines.push(`Section hint: ${selection.section}`);
  }
  if (typeof selection.page === 'number') {
    lines.push(`Page hint: ${selection.page}`);
  }

  lines.push('\nEvidence chunks (reference chunk_ids in citations):');
  if (evidence.hits.length === 0) {
    lines.push('- No matching chunks were retrieved; rely on the highlight.');
  } else {
    evidence.hits.slice(0, 6).forEach((chunk, index) => {
      lines.push(buildChunkSummary(chunk, index));
    });
  }

  if (evidence.figures.length) {
    lines.push('\nNearby figures:');
    evidence.figures.forEach((figure) => {
      lines.push(
        `- ${figure.figureId} (${figure.pageNumber ? `page ${figure.pageNumber}` : 'page ?'}): ${truncate(
          figure.caption,
          240,
        )}`,
      );
    });
  }

  lines.push(
    '\nInstructions: Return JSON matching the provided schema. Each bullet must cite at least one chunk_id from the evidence list using the citation_ids field.',
  );

  return lines.join('\n');
}

function parseLlmPayload(raw: string): LlmSummaryPayload {
  try {
    return JSON.parse(raw) as LlmSummaryPayload;
  } catch (error) {
    const reason =
      error instanceof Error ? error.message : 'Unable to parse JSON.';
    throw new Error(`Failed to parse inline summary payload: ${reason}`);
  }
}

function normalizeBullets(
  bullets: LlmSummaryBullet[] | undefined,
): SelectionSummaryBullet[] {
  if (!Array.isArray(bullets) || bullets.length === 0) {
    return [];
  }

  return bullets
    .map((bullet) => {
      const text = typeof bullet.text === 'string' ? bullet.text.trim() : '';
      if (!text) {
        return undefined;
      }
      const citationIds = Array.isArray(bullet.citation_ids)
        ? bullet.citation_ids
            .map((id) => (typeof id === 'string' ? id.trim() : ''))
            .filter((id) => id.length > 0)
        : [];
      return {
        text,
        citationIds,
      };
    })
    .filter((value): value is SelectionSummaryBullet => Boolean(value));
}

function normalizeDeeper(more: string[] | undefined): string[] {
  if (!Array.isArray(more)) {
    return [];
  }
  return more
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0);
}

function normalizeCitations(
  entries: LlmSummaryPayload['citations'],
): AnswerCitation[] {
  if (!Array.isArray(entries)) {
    return [];
  }

  const citations: AnswerCitation[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    if (!entry || typeof entry.chunk_id !== 'string') {
      continue;
    }
    const chunkId = entry.chunk_id.trim();
    if (!chunkId || seen.has(chunkId)) {
      continue;
    }

    const page =
      typeof entry.page === 'number' && Number.isFinite(entry.page)
        ? entry.page
        : undefined;

    const quote =
      typeof entry.quote === 'string' && entry.quote.trim()
        ? entry.quote.trim()
        : undefined;

    citations.push({
      chunkId,
      page,
      quote,
    });
    seen.add(chunkId);
  }

  return citations;
}

function ensureCitationForChunk(
  chunkId: string,
  existing: Map<string, AnswerCitation>,
  evidence: QuestionEvidenceContext,
): void {
  if (existing.has(chunkId)) {
    return;
  }

  const chunk =
    evidence.hits.find((hit) => hit.chunkId === chunkId) ??
    evidence.expandedWindow.find((hit) => hit.chunkId === chunkId);

  if (chunk) {
    existing.set(chunkId, {
      chunkId,
      page: chunk.pageNumber,
    });
  }
}

function buildCalloutResult(
  payload: LlmSummaryPayload,
  evidence: QuestionEvidenceContext,
): SelectionCalloutResult {
  const bullets = normalizeBullets(payload.bullets);
  const deeper = normalizeDeeper(payload.more);
  const citationList = normalizeCitations(payload.citations);
  const citationMap = new Map<string, AnswerCitation>();
  citationList.forEach((citation) =>
    citationMap.set(citation.chunkId, citation),
  );

  if (!bullets.length) {
    const fallbackChunk = evidence.hits[0];
    const fallbackText =
      fallbackChunk?.text?.slice(0, 180) ??
      evidence.selection?.text ??
      'No inline summary available.';
    const chunkId = fallbackChunk?.chunkId ?? 'unknown';
    bullets.push({
      text: fallbackText.trim(),
      citationIds: [chunkId],
    });
    if (fallbackChunk) {
      citationMap.set(chunkId, {
        chunkId,
        page: fallbackChunk.pageNumber,
      });
    }
  }

  bullets.forEach((bullet) => {
    if (!bullet.citationIds.length && evidence.hits[0]) {
      bullet.citationIds = [evidence.hits[0].chunkId];
    }
    bullet.citationIds.forEach((chunkId) => {
      ensureCitationForChunk(chunkId, citationMap, evidence);
    });
  });

  if (!deeper.length && evidence.hits[0]) {
    deeper.push(
      `Deeper context: ${truncate(
        evidence.hits[0].text.replace(/\s+/g, ' ').trim(),
        360,
      )}`,
    );
  }

  if (citationMap.size === 0 && evidence.hits[0]) {
    citationMap.set(evidence.hits[0].chunkId, {
      chunkId: evidence.hits[0].chunkId,
      page: evidence.hits[0].pageNumber,
    });
  }

  return {
    bullets,
    deeper,
    citations: Array.from(citationMap.values()),
  };
}

export async function summarizeSelection(
  paperId: string,
  selectionInput: QuestionSelection,
  options: { userId?: string; personaId?: string } = {},
): Promise<SelectionSummaryResult> {
  const selection = parseQuestionSelection(selectionInput);
  if (!selection?.text) {
    throw new Error('Selection text is required for inline summary.');
  }

  const evidence = await loadQuestionEvidence(
    paperId,
    selection.text,
    {
      selection,
    },
  );

  const personaPrompt = await fetchKontextSystemPrompt({
    taskId: 'inline_research_summary',
    paperId,
    userId: options.userId,
    personaId: options.personaId,
  }).catch(() => undefined);

  const systemPrompt = getSystemPrompt('selection_summary', personaPrompt);

  const userPrompt = buildSelectionUserPrompt(paperId, selection, evidence);

  const raw = await generateJson({
    systemPrompt,
    userPrompt,
    schema: SELECTION_SUMMARY_SCHEMA,
    temperature: 0.25,
  }, {
    taskName: 'inline_summary',
  });

  const payload = parseLlmPayload(raw);
  const callout = buildCalloutResult(payload, evidence);

  return {
    callout,
  };
}

export async function getSelectionFigures(
  paperId: string,
  selectionInput: QuestionSelection,
): Promise<SelectionFiguresResult> {
  const selection = parseQuestionSelection(selectionInput);
  if (!selection?.text) {
    throw new Error('Selection text is required.');
  }

  const evidence = await loadQuestionEvidence(paperId, selection.text, {
    selection,
  });

  return {
    figures: evidence.figures.slice(0, 6),
  };
}

export async function getSelectionCitations(
  paperId: string,
  selectionInput: QuestionSelection,
): Promise<SelectionCitationsResult> {
  const selection = parseQuestionSelection(selectionInput);
  if (!selection?.text) {
    throw new Error('Selection text is required.');
  }

  const evidence = await loadQuestionEvidence(paperId, selection.text, {
    selection,
  });

  return {
    citations: evidence.citations,
  };
}
