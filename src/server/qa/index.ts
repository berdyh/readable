import { fetchKontextSystemPrompt } from '@/server/summarize/kontext';

import { loadQuestionEvidence } from './context';
import { generateQaResponse } from './openai';
import type {
  AnswerCitation,
  AnswerResult,
  QaChunkContext,
  QuestionEvidenceContext,
  QuestionOptions,
} from './types';

const BASE_SYSTEM_PROMPT = `You are Readable's grounded research Q&A assistant. Use only the evidence provided from the paper to answer the user's question. 
- Cite page numbers inline in the answer using the format "(page N)".
- Prefer concise explanations that tie directly to the evidence.
- Summarize relevant figures or citations when they clarify the answer.
- If the evidence does not contain the answer, say so explicitly and suggest the closest related insight if available.
- Obey the required JSON schema exactly; do not include any additional text.`;

const QA_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['answer', 'citations'],
  properties: {
    answer: {
      type: 'string',
      minLength: 1,
    },
    citations: {
      type: 'array',
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['chunk_id', 'page', 'quote'],
        properties: {
          chunk_id: { type: 'string', minLength: 1 },
          page: { type: 'integer', minimum: 1 },
          quote: { type: 'string' },
        },
      },
    },
  },
};

interface LlmCitationPayload {
  chunk_id: string;
  page: number;
  quote: string;
}

interface LlmQaPayload {
  answer?: string;
  citations?: LlmCitationPayload[];
}

function mergeSystemPrompt(personaPrompt?: string): string {
  if (!personaPrompt) {
    return BASE_SYSTEM_PROMPT;
  }

  return `${BASE_SYSTEM_PROMPT}\n\nPersona guidance:\n${personaPrompt}`;
}

function truncateText(text: string, maxLength = 600): string {
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function formatPage(page?: number): string {
  if (typeof page === 'number' && Number.isFinite(page) && page > 0) {
    return `page ${page}`;
  }
  return 'page ?';
}

function formatChunk(
  chunk: QaChunkContext,
  index: number,
  label: string,
): string {
  const header = `${label} ${index + 1}: chunk_id=${chunk.chunkId} (${formatPage(
    chunk.pageNumber,
  )}${chunk.section ? ` · section: ${chunk.section}` : ''})`;
  const body = truncateText(chunk.text.replace(/\s+/g, ' ').trim(), 700);
  return `${header}\n${body}`;
}

function formatCitations(citations: LlmCitationPayload[]): AnswerCitation[] {
  const results: AnswerCitation[] = [];
  const seen = new Set<string>();

  for (const citation of citations) {
    if (!citation || typeof citation.chunk_id !== 'string') {
      continue;
    }

    const chunkId = citation.chunk_id.trim();
    if (!chunkId || seen.has(chunkId)) {
      continue;
    }

    const page =
      typeof citation.page === 'number' && Number.isFinite(citation.page)
        ? citation.page
        : undefined;

    const quote =
      typeof citation.quote === 'string' && citation.quote.trim()
        ? citation.quote.trim()
        : undefined;

    results.push({
      chunkId,
      page,
      quote,
    });
    seen.add(chunkId);
  }

  return results;
}

function buildQaUserPrompt(
  question: string,
  evidence: QuestionEvidenceContext,
): string {
  const lines: string[] = [];

  lines.push(`Paper ID: ${evidence.paperId}`);
  lines.push(`Question: ${question.trim()}`);

  if (evidence.selection) {
    const parts: string[] = [];
    if (evidence.selection.text) {
      parts.push(`“${truncateText(evidence.selection.text, 360)}”`);
    }
    if (typeof evidence.selection.page === 'number') {
      parts.push(`page ${evidence.selection.page}`);
    }
    if (evidence.selection.section) {
      parts.push(`section ${evidence.selection.section}`);
    }
    if (parts.length) {
      lines.push(`User selection context: ${parts.join(' · ')}`);
    }
  }

  if (evidence.hits.length) {
    lines.push('\nPrimary evidence chunks:');
    evidence.hits.slice(0, 6).forEach((chunk, index) => {
      lines.push(formatChunk(chunk, index, 'Hit'));
    });
  } else {
    lines.push('\nNo direct evidence chunks retrieved.');
  }

  if (evidence.expandedWindow.length) {
    lines.push('\nNeighboring context:');
    evidence.expandedWindow.slice(0, 6).forEach((chunk, index) => {
      lines.push(formatChunk(chunk, index, 'Window'));
    });
  }

  if (evidence.figures.length) {
    lines.push('\nReferenced figures:');
    evidence.figures.forEach((figure) => {
      const caption = truncateText(figure.caption, 360);
      lines.push(
        `- ${figure.figureId} (${formatPage(figure.pageNumber)}): ${caption}`,
      );
    });
  }

  if (evidence.citations.length) {
    lines.push('\nCited background for potential prerequisites:');
    evidence.citations.forEach((citation) => {
      const parts: string[] = [];
      const title = citation.title
        ? truncateText(citation.title, 240)
        : `Citation ${citation.citationId}`;
      parts.push(title);

      if (citation.source) {
        parts.push(`source: ${citation.source}`);
      }
      if (citation.year) {
        parts.push(`year: ${citation.year}`);
      }
      if (citation.authors?.length) {
        parts.push(`authors: ${citation.authors.join(', ')}`);
      }
      if (citation.url) {
        parts.push(`url: ${citation.url}`);
      }
      if (citation.arxivId) {
        parts.push(`arXiv: ${citation.arxivId}`);
      }
      lines.push(`- ${parts.join(' · ')}`);

      if (citation.abstract) {
        lines.push(
          `  abstract: ${truncateText(citation.abstract.replace(/\s+/g, ' '), 480)}`,
        );
      }
    });
  }

  lines.push(
    '\nInstructions: Use the evidence above to answer the question. Reference specific chunk_ids and include page numbers in the answer (e.g., "(page 4)"). If the evidence is insufficient, respond that the paper does not address the question. Return JSON that matches the provided schema.',
  );

  return lines.join('\n');
}

function parseLlmPayload(raw: string): LlmQaPayload {
  try {
    return JSON.parse(raw) as LlmQaPayload;
  } catch (error) {
    const reason =
      error instanceof Error && error.message
        ? error.message
        : 'Unknown parsing error.';
    throw new Error(`Failed to parse OpenAI QA response JSON: ${reason}`, {
      cause: error instanceof Error ? error : undefined,
    });
  }
}

export async function answerPaperQuestion(
  paperId: string,
  question: string,
  options: QuestionOptions = {},
): Promise<AnswerResult> {
  const evidence = await loadQuestionEvidence(paperId, question, options);

  const personaPrompt = await fetchKontextSystemPrompt({
    taskId: 'qa_research_paper',
    paperId,
    userId: options.userId,
    personaId: options.personaId,
  }).catch(() => undefined);

  const systemPrompt = mergeSystemPrompt(personaPrompt);
  const userPrompt = buildQaUserPrompt(question, evidence);

  const raw = await generateQaResponse({
    systemPrompt,
    userPrompt,
    schema: QA_RESPONSE_SCHEMA,
  });

  const payload = parseLlmPayload(raw);

  const answer = payload.answer?.trim();
  if (!answer) {
    throw new Error('OpenAI QA response missing answer text.');
  }

  const citationsPayload = Array.isArray(payload.citations)
    ? payload.citations
    : [];

  const citations = formatCitations(citationsPayload);

  if (citations.length === 0 && evidence.hits.length > 0) {
    const fallbackChunk = evidence.hits[0];
    citations.push({
      chunkId: fallbackChunk.chunkId,
      page: fallbackChunk.pageNumber,
    });
  }

  return {
    answer,
    cites: citations,
  };
}
