import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/qa/context', () => ({
  loadQuestionEvidence: vi.fn(),
}));

vi.mock('@/server/qa/openai', () => ({
  generateQaResponse: vi.fn(),
}));

vi.mock('@/server/summarize/kontext', () => ({
  fetchKontextSystemPrompt: vi.fn(),
}));

import { answerPaperQuestion } from '@/server/qa';
import { loadQuestionEvidence } from '@/server/qa/context';
import { generateQaResponse } from '@/server/qa/openai';
import { fetchKontextSystemPrompt } from '@/server/summarize/kontext';
import type { QuestionEvidenceContext } from '@/server/qa/types';

const mockEvidence = (overrides: Partial<QuestionEvidenceContext> = {}): QuestionEvidenceContext => ({
  paperId: 'paper-1',
  query: 'test query',
  hits: [
    {
      id: 'uuid-hit',
      chunkId: 'chunk-1',
      text: 'Transformer introduces self-attention mechanism.',
      section: 'Introduction',
      pageNumber: 3,
      score: 0.92,
      distance: 0.08,
      citations: [],
      figureIds: [],
    },
  ],
  expandedWindow: [],
  figures: [],
  citations: [],
  selection: undefined,
  ...overrides,
});

describe('answerPaperQuestion', () => {
  const mockedEvidence = vi.mocked(loadQuestionEvidence);
  const mockedGenerate = vi.mocked(generateQaResponse);
  const mockedKontext = vi.mocked(fetchKontextSystemPrompt);

  it('returns answer and cites from the language model payload', async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue(
      JSON.stringify({
        answer: 'Self-attention lets each token weigh others (page 3).',
        citations: [{ chunk_id: 'chunk-1', page: 3, quote: 'Self-attention mechanism' }],
      }),
    );
    mockedKontext.mockResolvedValue('Tailor explanations for graduate-level ML audience.');

    const result = await answerPaperQuestion('paper-1', 'What is self-attention?');

    expect(mockedEvidence).toHaveBeenCalledWith('paper-1', 'What is self-attention?', {});
    expect(mockedGenerate).toHaveBeenCalledOnce();
    expect(result).toEqual({
      answer: 'Self-attention lets each token weigh others (page 3).',
      cites: [{ chunkId: 'chunk-1', page: 3, quote: 'Self-attention mechanism' }],
    });
  });

  it('falls back to first hit when citations array is empty', async () => {
    const evidence = mockEvidence({
      hits: [
        {
          id: 'uuid-hit',
          chunkId: 'chunk-2',
          text: 'The encoder uses multi-head attention.',
          section: 'Model',
          pageNumber: 4,
          score: 0.88,
          distance: 0.12,
          citations: [],
          figureIds: [],
        },
      ],
    });

    mockedEvidence.mockResolvedValue(evidence);
    mockedGenerate.mockResolvedValue(
      JSON.stringify({ answer: 'The encoder stacks multi-head attention layers (page 4).' }),
    );
    mockedKontext.mockResolvedValue(undefined);

    const result = await answerPaperQuestion('paper-1', 'How does the encoder operate?');

    expect(result.cites).toEqual([
      {
        chunkId: 'chunk-2',
        page: 4,
      },
    ]);
  });

  it('throws when the OpenAI payload cannot be parsed', async () => {
    mockedEvidence.mockResolvedValue(mockEvidence());
    mockedGenerate.mockResolvedValue('not-json');
    mockedKontext.mockResolvedValue(undefined);

    await expect(
      answerPaperQuestion('paper-1', 'Explain positional encodings'),
    ).rejects.toThrow(/Failed to parse OpenAI QA response JSON/);
  });
});
