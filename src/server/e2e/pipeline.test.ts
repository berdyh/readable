import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  PaperFigure,
  PaperReference,
  PaperSection,
} from '@/server/ingest';

interface MockChunk {
  id: string;
  paperId: string;
  chunkId: string;
  text: string;
  section?: string;
  pageNumber?: number;
  citations: string[];
  figureIds: string[];
}

interface MockFigure {
  id: string;
  paperId: string;
  figureId: string;
  caption?: string;
  pageNumber?: number;
  imageUrl?: string;
  chunkIds?: string[];
}

interface MockCitation {
  id: string;
  paperId: string;
  citationId: string;
  title?: string;
  authors?: string[];
  year?: number;
  source?: string;
  doi?: string;
  url?: string;
  chunkIds?: string[];
}

interface LlmSummaryPayload {
  sections: Array<{
    section_id: string;
    title: string;
    summary: string;
    reasoning: string;
    key_points?: string[];
  }>;
  key_findings: Array<{
    statement: string;
    evidence: string;
    supporting_sections: string[];
    related_figures?: string[];
  }>;
  figures: Array<{
    figure_id: string;
    insight: string;
    caption_summary?: string;
  }>;
}

interface LlmQaPayload {
  answer: string;
  citations: Array<{
    chunk_id: string;
    page?: number;
    quote?: string;
  }>;
}

interface PersonaFixtures<T> {
  base: T;
  persona?: T;
}

interface PaperFixture {
  metadata: {
    id: string;
    title: string;
    abstract: string;
    authors: string[];
  };
  tei: {
    sections: PaperSection[];
    references: PaperReference[];
    figures: PaperFigure[];
    pageCount: number;
  };
  summary: PersonaFixtures<LlmSummaryPayload>;
  qa: Record<string, PersonaFixtures<LlmQaPayload>>;
}

const PERSONA_PROMPTS: Record<string, string> = {
  'demo-persona':
    'Persona focus: translate dense technical results into accessible takeaways for product-minded stakeholders.',
};

const PAPER_FIXTURES: Record<string, PaperFixture> = {
  '1706.03762': {
    metadata: {
      id: '1706.03762',
      title: 'Attention Is All You Need',
      abstract:
        'The Transformer leverages self-attention to achieve state-of-the-art performance on translation tasks.',
      authors: [
        'Ashish Vaswani',
        'Noam Shazeer',
        'Niki Parmar',
        'Jakob Uszkoreit',
      ],
    },
    tei: {
      pageCount: 12,
      sections: [
        {
          id: 'S1',
          title: 'Introduction',
          level: 1,
          pageStart: 1,
          pageEnd: 2,
          paragraphs: [
            {
              id: 'S1-p1',
              text: 'The Transformer introduces self-attention to eliminate recurrence and enable efficient parallel computation.',
              citations: ['bahdanau2014'],
              figureIds: [],
              pageNumber: 1,
            },
            {
              id: 'S1-p2',
              text: 'By leveraging scaled dot-product attention, the model captures dependencies without sequential bottlenecks.',
              citations: ['vaswani2017'],
              figureIds: [],
              pageNumber: 2,
            },
          ],
        },
        {
          id: 'S2',
          title: 'Model Architecture',
          level: 1,
          pageStart: 3,
          pageEnd: 4,
          paragraphs: [
            {
              id: 'S2-p1',
              text: 'Multi-head attention allows the encoder to jointly attend to information from different representation subspaces at different positions.',
              citations: ['vaswani2017'],
              figureIds: ['fig-arch'],
              pageNumber: 3,
            },
          ],
        },
        {
          id: 'S3',
          title: 'Results',
          level: 1,
          pageStart: 5,
          pageEnd: 6,
          paragraphs: [
            {
              id: 'S3-p1',
              text: 'On WMT14 English-to-German, the Transformer achieves a BLEU score of 41.8, surpassing previous convolutional and recurrent models.',
              citations: ['wu2016'],
              figureIds: ['fig-results'],
              pageNumber: 5,
            },
          ],
        },
      ],
      references: [
        {
          id: 'bahdanau2014',
          title: 'Neural Machine Translation by Jointly Learning to Align and Translate',
          authors: ['Dzmitry Bahdanau', 'Kyunghyun Cho', 'Yoshua Bengio'],
          year: 2014,
          source: 'ICLR',
          url: 'https://arxiv.org/abs/1409.0473',
        },
        {
          id: 'vaswani2017',
          title: 'Attention Is All You Need',
          authors: ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar'],
          year: 2017,
          source: 'NIPS',
          url: 'https://arxiv.org/abs/1706.03762',
        },
        {
          id: 'wu2016',
          title: 'Google\'s Neural Machine Translation System: Bridging the Gap between Human and Machine Translation',
          authors: ['Yonghui Wu', 'Mike Schuster'],
          year: 2016,
          source: 'arXiv',
          url: 'https://arxiv.org/abs/1609.08144',
        },
      ],
      figures: [
        {
          id: 'fig-arch',
          label: 'Figure 1',
          caption: 'Transformer encoder-decoder architecture overview.',
          pageNumber: 3,
        },
        {
          id: 'fig-results',
          label: 'Figure 2',
          caption: 'BLEU improvements over recurrent baselines on WMT14.',
          pageNumber: 5,
        },
      ],
    },
    summary: {
      base: {
        sections: [
          {
            section_id: 'S1',
            title: 'Introduction',
            summary:
              'The authors frame self-attention as a route to faster, more scalable translation by discarding recurrence.',
            reasoning:
              'Removing sequential dependencies enables hardware-efficient training without sacrificing contextual awareness.',
            key_points: [
              'Self-attention replaces recurrence for efficiency.',
              'Parallelization reduces training bottlenecks.',
            ],
          },
          {
            section_id: 'S2',
            title: 'Model Architecture',
            summary:
              'The model stacks multi-head self-attention and feed-forward layers with residual connections.',
            reasoning:
              'Multiple heads capture complementary relationships while skip connections stabilize optimization.',
            key_points: [
              'Multi-head attention views tokens from different subspaces.',
              'Position-wise feed-forward layers refine representations.',
            ],
          },
          {
            section_id: 'S3',
            title: 'Results',
            summary:
              'The Transformer outperforms prior systems on WMT14 translation benchmarks.',
            reasoning:
              'Empirical BLEU gains stem from deeper attention stacks and label smoothing regularization.',
            key_points: [
              'Achieves 41.8 BLEU on WMT14 En-De.',
              'Outperforms convolutional and recurrent baselines.',
            ],
          },
        ],
        key_findings: [
          {
            statement:
              'Self-attention eliminates recurrence while retaining long-range reasoning.',
            evidence:
              'Parallel attention layers process sequences without step-wise dependencies.',
            supporting_sections: ['S1', 'S2'],
            related_figures: ['fig-arch'],
          },
          {
            statement:
              'The architecture delivers state-of-the-art machine translation quality.',
            evidence:
              'On WMT14 English-to-German the Transformer reaches 41.8 BLEU, exceeding prior work.',
            supporting_sections: ['S3'],
            related_figures: ['fig-results'],
          },
        ],
        figures: [
          {
            figure_id: 'fig-arch',
            insight:
              'Visualizes how stacked encoder-decoder blocks coordinate through multi-head attention.',
            caption_summary: 'Architecture diagram.',
          },
          {
            figure_id: 'fig-results',
            insight:
              'Highlights BLEU gains showing the practical impact of the architecture.',
            caption_summary: 'BLEU performance comparison.',
          },
        ],
      },
    },
    qa: {
      'How does self-attention improve efficiency?': {
        base: {
          answer:
            'Self-attention lets each token attend to all others in parallel, removing the sequential bottleneck and enabling efficient computation (page 1).',
          citations: [
            {
              chunk_id: 'S1-p1',
              page: 1,
              quote:
                'The Transformer introduces self-attention to eliminate recurrence and enable efficient parallel computation.',
            },
            {
              chunk_id: 'S2-p1',
              page: 3,
            },
          ],
        },
      },
    },
  },
  '1810.04805': {
    metadata: {
      id: '1810.04805',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      abstract:
        'BERT pre-trains bidirectional Transformers on large corpora to improve downstream NLP tasks.',
      authors: [
        'Jacob Devlin',
        'Ming-Wei Chang',
        'Kenton Lee',
        'Kristina Toutanova',
      ],
    },
    tei: {
      pageCount: 14,
      sections: [
        {
          id: 'S1',
          title: 'Overview',
          level: 1,
          pageStart: 1,
          pageEnd: 2,
          paragraphs: [
            {
              id: 'S1-p1',
              text: 'BERT introduces bidirectional Transformer encoders that leverage masked language modeling and next sentence prediction.',
              citations: ['vaswani2017'],
              figureIds: [],
              pageNumber: 1,
            },
          ],
        },
        {
          id: 'S2',
          title: 'Pre-training Tasks',
          level: 1,
          pageStart: 3,
          pageEnd: 4,
          paragraphs: [
            {
              id: 'S2-p1',
              text: 'The model pre-trains on BooksCorpus and English Wikipedia using masked language modeling and next sentence prediction objectives.',
              citations: ['zhu2015', 'devlin2018'],
              figureIds: ['fig-pretrain'],
              pageNumber: 3,
            },
          ],
        },
        {
          id: 'S3',
          title: 'Fine-tuning Performance',
          level: 1,
          pageStart: 6,
          pageEnd: 7,
          paragraphs: [
            {
              id: 'S3-p1',
              text: 'Fine-tuning BERT yields new state-of-the-art results on GLUE, MultiNLI, and SQuAD benchmarks.',
              citations: ['wang2018'],
              figureIds: ['fig-results'],
              pageNumber: 6,
            },
          ],
        },
      ],
      references: [
        {
          id: 'zhu2015',
          title: 'Aligning Books and Movies: Towards Story-like Visual Explanations by Watching Movies and Reading Books',
          authors: ['Yukun Zhu', 'Ryan Kiros'],
          year: 2015,
          source: 'ICCV',
          url: 'https://arxiv.org/abs/1506.06724',
        },
        {
          id: 'devlin2018',
          title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
          authors: ['Jacob Devlin', 'Ming-Wei Chang'],
          year: 2018,
          source: 'arXiv',
          url: 'https://arxiv.org/abs/1810.04805',
        },
        {
          id: 'wang2018',
          title: 'GLUE: A Multi-Task Benchmark and Analysis Platform for Natural Language Understanding',
          authors: ['Alex Wang', 'Amanpreet Singh'],
          year: 2018,
          source: 'ICLR',
          url: 'https://arxiv.org/abs/1804.07461',
        },
      ],
      figures: [
        {
          id: 'fig-pretrain',
          label: 'Figure 1',
          caption: 'BERT pre-training tasks and corpora overview.',
          pageNumber: 3,
        },
        {
          id: 'fig-results',
          label: 'Figure 2',
          caption: 'Fine-tuning results across NLP benchmarks.',
          pageNumber: 6,
        },
      ],
    },
    summary: {
      base: {
        sections: [
          {
            section_id: 'S1',
            title: 'Overview',
            summary:
              'BERT adapts the Transformer encoder to learn deep bidirectional representations with two unsupervised objectives.',
            reasoning:
              'Bidirectionality captures context from both directions, enabling stronger general-purpose language models.',
          },
          {
            section_id: 'S2',
            title: 'Pre-training Tasks',
            summary:
              'Masked language modeling and next sentence prediction on BooksCorpus and Wikipedia provide broad linguistic knowledge.',
            reasoning:
              'These complementary objectives teach both token-level understanding and sentence-level coherence.',
          },
          {
            section_id: 'S3',
            title: 'Fine-tuning Performance',
            summary:
              'Fine-tuned BERT achieves state-of-the-art results on GLUE, MultiNLI, and SQuAD benchmarks.',
            reasoning:
              'Task-specific heads leverage shared representations, delivering gains without heavy engineering.',
          },
        ],
        key_findings: [
          {
            statement:
              'Pre-training on large unlabeled corpora transfers effectively to diverse NLP tasks.',
            evidence:
              'Fine-tuned models exceed prior best results on GLUE and SQuAD.',
            supporting_sections: ['S2', 'S3'],
            related_figures: ['fig-results'],
          },
        ],
        figures: [
          {
            figure_id: 'fig-pretrain',
            insight:
              'Summarizes the dual-objective setup leveraging BooksCorpus and Wikipedia.',
          },
          {
            figure_id: 'fig-results',
            insight:
              'Shows benchmark improvements that validate the pre-training strategy.',
          },
        ],
      },
      persona: {
        sections: [
          {
            section_id: 'S1',
            title: 'Overview',
            summary:
              'Think of BERT as a reusable language foundation: it soaks up context from both directions so downstream teams start with rich intuition.',
            reasoning:
              'Bidirectional attention supplies product teams with ready-to-adapt representations, accelerating iteration.',
          },
          {
            section_id: 'S2',
            title: 'Pre-training Tasks',
            summary:
              'It learns by blanking out words and predicting sentence order across BooksCorpus and Wikipedia—essentially teaching itself broad knowledge.',
            reasoning:
              'These routines mimic real documentation scenarios, aligning with stakeholder needs.',
          },
          {
            section_id: 'S3',
            title: 'Fine-tuning Performance',
            summary:
              'When fine-tuned, BERT consistently tops GLUE, MultiNLI, and SQuAD—evidence the foundation transfers cleanly.',
            reasoning:
              'Teams simply bolt on light heads, so the heavy lifting stays in pre-training.',
          },
        ],
        key_findings: [
          {
            statement:
              'Foundation models let product groups ship faster because broad linguistic knowledge is already baked in.',
            evidence:
              'Across GLUE tasks BERT outperforms bespoke models, proving the reuse story.',
            supporting_sections: ['S2', 'S3'],
            related_figures: ['fig-results'],
          },
        ],
        figures: [
          {
            figure_id: 'fig-pretrain',
            insight:
              'Clarifies the self-supervised recipe stakeholders can reuse for new domains.',
          },
          {
            figure_id: 'fig-results',
            insight:
              'Quantifies the business upside via benchmark wins that reduce experimentation risk.',
          },
        ],
      },
    },
    qa: {
      'Which corpora power BERT pre-training?': {
        base: {
          answer:
            'BERT pre-trains on BooksCorpus together with English Wikipedia, pairing masked language modeling with next sentence prediction (page 3).',
          citations: [
            {
              chunk_id: 'S2-p1',
              page: 3,
              quote:
                'The model pre-trains on BooksCorpus and English Wikipedia using masked language modeling and next sentence prediction objectives.',
            },
          ],
        },
        persona: {
          answer:
            'To give teams broad intuition, BERT trains on the BooksCorpus plus English Wikipedia—huge, complementary corpora—before fine-tuning (page 3).',
          citations: [
            {
              chunk_id: 'S2-p1',
              page: 3,
            },
          ],
        },
      },
    },
  },
};

const CITATION_METADATA: Record<
  string,
  {
    id: string;
    title: string;
    abstract?: string;
    authors: string[];
  }
> = {
  '1409.0473': {
    id: '1409.0473',
    title:
      'Neural Machine Translation by Jointly Learning to Align and Translate',
    abstract:
      'Introduces an attention-based encoder-decoder model for machine translation.',
    authors: ['Dzmitry Bahdanau', 'Kyunghyun Cho', 'Yoshua Bengio'],
  },
  '1609.08144': {
    id: '1609.08144',
    title:
      "Google's Neural Machine Translation System: Bridging the Gap between Human and Machine Translation",
    abstract:
      'Describes the GNMT system that achieves human parity on select translation benchmarks.',
    authors: ['Yonghui Wu', 'Mike Schuster'],
  },
  '1506.06724': {
    id: '1506.06724',
    title: 'Aligning Books and Movies',
    authors: ['Yukun Zhu', 'Ryan Kiros'],
  },
  '1804.07461': {
    id: '1804.07461',
    title: 'GLUE: A Multi-Task Benchmark and Analysis Platform',
    authors: ['Alex Wang', 'Amanpreet Singh'],
  },
};

const kontextRequests: Array<{
  taskId: string;
  paperId?: string;
  userId?: string;
  personaId?: string;
}> = [];

const summaryRequests: Array<{
  paperId: string;
  persona: 'base' | 'persona';
  systemPrompt: string;
  userPrompt: string;
}> = [];

const qaRequests: Array<{
  paperId: string;
  persona: 'base' | 'persona';
  question: string;
  systemPrompt: string;
  userPrompt: string;
}> = [];

const mockStore = {
  chunks: new Map<string, MockChunk[]>(),
  figures: new Map<string, MockFigure[]>(),
  citations: new Map<string, MockCitation[]>(),
};

function resetStore() {
  mockStore.chunks.clear();
  mockStore.figures.clear();
  mockStore.citations.clear();
}

function cloneChunk(chunk: MockChunk): MockChunk {
  return {
    ...chunk,
    citations: [...chunk.citations],
    figureIds: [...chunk.figureIds],
  };
}

function cloneFigure(figure: MockFigure): MockFigure {
  return {
    ...figure,
    chunkIds: figure.chunkIds ? [...figure.chunkIds] : undefined,
  };
}

function cloneCitation(citation: MockCitation): MockCitation {
  return {
    ...citation,
    authors: citation.authors ? [...citation.authors] : undefined,
    chunkIds: citation.chunkIds ? [...citation.chunkIds] : undefined,
  };
}

function ensureChunks(paperId: string): MockChunk[] {
  if (!mockStore.chunks.has(paperId)) {
    mockStore.chunks.set(paperId, []);
  }
  return mockStore.chunks.get(paperId)!;
}

function ensureFigures(paperId: string): MockFigure[] {
  if (!mockStore.figures.has(paperId)) {
    mockStore.figures.set(paperId, []);
  }
  return mockStore.figures.get(paperId)!;
}

function ensureCitations(paperId: string): MockCitation[] {
  if (!mockStore.citations.has(paperId)) {
    mockStore.citations.set(paperId, []);
  }
  return mockStore.citations.get(paperId)!;
}

const fetchKontextSystemPromptMock = vi.fn(
  async (request: {
    taskId: string;
    paperId?: string;
    userId?: string;
    personaId?: string;
  }) => {
    kontextRequests.push(request);
    if (request.personaId) {
      return PERSONA_PROMPTS[request.personaId] ?? 'Persona fallback prompt.';
    }
    return undefined;
  },
);

function extractPaperIdFromPrompt(prompt: string): string | undefined {
  const match = prompt.match(/Paper ID:\s*([^\s]+)/);
  return match?.[1]?.trim();
}

const generateJsonSummaryMock = vi.fn(
  async (params: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string> => {
    const paperId = extractPaperIdFromPrompt(params.userPrompt);
    if (!paperId) {
      throw new Error('Unable to detect paper ID in summary prompt.');
    }

    const personaMode: 'base' | 'persona' = params.systemPrompt.trim().startsWith('Persona focus')
      ? 'persona'
      : 'base';

    summaryRequests.push({
      paperId,
      persona: personaMode,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
    });

    const fixture = PAPER_FIXTURES[paperId];
    if (!fixture) {
      throw new Error(`Missing summary fixture for paper ${paperId}`);
    }

    const payload =
      personaMode === 'persona' && fixture.summary.persona
        ? fixture.summary.persona
        : fixture.summary.base;

    return JSON.stringify(payload);
  },
);

const generateQaResponseMock = vi.fn(
  async (params: {
    systemPrompt: string;
    userPrompt: string;
  }): Promise<string> => {
    const paperId = extractPaperIdFromPrompt(params.userPrompt);
    if (!paperId) {
      throw new Error('Unable to detect paper ID in QA prompt.');
    }

    const questionMatch = params.userPrompt.match(/Question:\s*(.+)/);
    const question = questionMatch?.[1]?.trim() ?? '';

    const personaMode: 'base' | 'persona' = params.systemPrompt.includes(
      'Persona guidance:',
    )
      ? 'persona'
      : 'base';

    qaRequests.push({
      paperId,
      persona: personaMode,
      question,
      systemPrompt: params.systemPrompt,
      userPrompt: params.userPrompt,
    });

    const fixture = PAPER_FIXTURES[paperId];
    const qaEntry = fixture?.qa[question];
    if (!qaEntry) {
      throw new Error(`Missing QA fixture for "${question}"`);
    }

    const payload =
      personaMode === 'persona' && qaEntry.persona
        ? qaEntry.persona
        : qaEntry.base;

    return JSON.stringify(payload);
  },
);

vi.mock('@/server/ingest/arxiv', () => ({
  fetchArxivMetadata: vi.fn(
    async (arxivId: string): Promise<
      | {
          id: string;
          title?: string;
          abstract?: string;
          authors: string[];
        }
      | undefined
    > => {
      const direct = PAPER_FIXTURES[arxivId]?.metadata;
      if (direct) {
        return {
          id: direct.id,
          title: direct.title,
          abstract: direct.abstract,
          authors: direct.authors,
        };
      }

      if (CITATION_METADATA[arxivId]) {
        return {
          id: CITATION_METADATA[arxivId].id,
          title: CITATION_METADATA[arxivId].title,
          abstract: CITATION_METADATA[arxivId].abstract,
          authors: CITATION_METADATA[arxivId].authors,
        };
      }

      return undefined;
    },
  ),
  fetchAr5ivHtml: vi.fn(async () => ''),
  fetchArxivPdf: vi.fn(async (arxivId: string) =>
    new TextEncoder().encode(arxivId).buffer,
  ),
}));

vi.mock('@/server/ingest/ar5iv', () => ({
  parseAr5ivHtml: vi.fn(() => ({
    sections: [],
    figures: [],
  })),
}));

vi.mock('@/server/ingest/grobid', () => ({
  fetchGrobidTei: vi.fn(async (pdfBuffer: ArrayBuffer) => {
    const decoder = new TextDecoder();
    const id = decoder.decode(pdfBuffer);
    return `tei:${id}`;
  }),
  parseGrobidTei: vi.fn((teiPayload: string) => {
    const [, paperId] = teiPayload.split(':');
    const fixture = PAPER_FIXTURES[paperId];
    if (!fixture) {
      return {
        sections: [],
        references: [],
        figures: [],
      };
    }

    return fixture.tei;
  }),
}));

vi.mock('@/server/ingest/pdf', () => ({
  extractPdfText: vi.fn(async () => undefined),
  shouldUseOcr: vi.fn(() => false),
}));

vi.mock('@/server/ingest/ocr', () => ({
  runDeepSeekOcr: vi.fn(async () => undefined),
}));

const weaviateMock = {
  getWeaviateClient: vi.fn(() => ({ kind: 'mock-client' })),

  upsertPaperChunks: vi.fn(async (chunks: Array<Omit<MockChunk, 'id'>>) => {
    for (const chunk of chunks) {
      const list = ensureChunks(chunk.paperId);
      const filtered = list.filter(
        (existing) => existing.chunkId !== chunk.chunkId,
      );
      filtered.push({
        ...chunk,
        id: `${chunk.paperId}:${chunk.chunkId}`,
        citations: [...chunk.citations],
        figureIds: [...chunk.figureIds],
      });
      mockStore.chunks.set(chunk.paperId, filtered);
    }

    return chunks.map((chunk) => `${chunk.paperId}:${chunk.chunkId}`);
  }),

  upsertFigures: vi.fn(async (figures: Array<Omit<MockFigure, 'id'>>) => {
    for (const figure of figures) {
      const list = ensureFigures(figure.paperId);
      const filtered = list.filter(
        (existing) => existing.figureId !== figure.figureId,
      );
      filtered.push({
        ...figure,
        id: `${figure.paperId}:${figure.figureId}`,
        chunkIds: figure.chunkIds ? [...figure.chunkIds] : undefined,
      });
      mockStore.figures.set(figure.paperId, filtered);
    }
    return figures.map((figure) => `${figure.paperId}:${figure.figureId}`);
  }),

  upsertCitations: vi.fn(async (citations: Array<Omit<MockCitation, 'id'>>) => {
    for (const citation of citations) {
      const list = ensureCitations(citation.paperId);
      const filtered = list.filter(
        (existing) => existing.citationId !== citation.citationId,
      );
      filtered.push({
        ...citation,
        id: `${citation.paperId}:${citation.citationId}`,
        chunkIds: citation.chunkIds ? [...citation.chunkIds] : undefined,
      });
      mockStore.citations.set(citation.paperId, filtered);
    }

    return citations.map(
      (citation) => `${citation.paperId}:${citation.citationId}`,
    );
  }),

  fetchPaperChunksByPaperId: vi.fn(async (paperId: string) => {
    const chunks = mockStore.chunks.get(paperId) ?? [];
    return chunks.map(cloneChunk).sort((a, b) =>
      a.chunkId.localeCompare(b.chunkId),
    );
  }),

  fetchPaperFiguresByPaperId: vi.fn(async (paperId: string) => {
    const figures = mockStore.figures.get(paperId) ?? [];
    return figures.map(cloneFigure);
  }),

  fetchPaperCitationsByPaperId: vi.fn(async (paperId: string) => {
    const citations = mockStore.citations.get(paperId) ?? [];
    return citations.map(cloneCitation);
  }),

  hybridPaperChunkSearch: vi.fn(
    async (options: {
      paperId: string;
      query: string;
      limit?: number;
    }) => {
      const chunks = mockStore.chunks.get(options.paperId) ?? [];
      const normalizedQuery = options.query.toLowerCase();

      const matching = chunks.filter((chunk) => {
        const haystack = `${chunk.text} ${chunk.section ?? ''}`.toLowerCase();
        return haystack.includes(normalizedQuery);
      });

      const selected =
        matching.length > 0 ? matching : chunks.slice(0, options.limit ?? 5);

      const hits = selected.slice(0, options.limit ?? 5).map((chunk, index) => ({
        id: `${chunk.paperId}:${chunk.chunkId}:${index}`,
        paperId: chunk.paperId,
        chunkId: chunk.chunkId,
        text: chunk.text,
        section: chunk.section,
        pageNumber: chunk.pageNumber,
        score: 1 - index * 0.05,
        distance: index * 0.05,
        citations: chunk.citations,
        figureIds: chunk.figureIds,
        additional: {},
      }));

      return {
        hits,
        expandedWindow: [],
      };
    },
  ),
};

vi.mock('@/server/weaviate', () => weaviateMock);

vi.mock('@/server/weaviate/paper', () => ({
  fetchPaperChunksByPaperId: weaviateMock.fetchPaperChunksByPaperId,
  fetchPaperFiguresByPaperId: weaviateMock.fetchPaperFiguresByPaperId,
  fetchPaperCitationsByPaperId: weaviateMock.fetchPaperCitationsByPaperId,
}));

vi.mock('@/server/summarize/kontext', () => ({
  fetchKontextSystemPrompt: fetchKontextSystemPromptMock,
}));

vi.mock('@/server/summarize/openai', () => ({
  generateJsonSummary: generateJsonSummaryMock,
}));

vi.mock('@/server/qa/openai', () => ({
  generateQaResponse: generateQaResponseMock,
}));

let ingestPaper: typeof import('@/server/ingest').ingestPaper;
let summarizePaper: typeof import('@/server/summarize').summarizePaper;
let answerPaperQuestion: typeof import('@/server/qa').answerPaperQuestion;

beforeAll(async () => {
  ({ ingestPaper } = await import('@/server/ingest'));
  ({ summarizePaper } = await import('@/server/summarize'));
  ({ answerPaperQuestion } = await import('@/server/qa'));
});

beforeEach(() => {
  resetStore();
  kontextRequests.length = 0;
  summaryRequests.length = 0;
  qaRequests.length = 0;
  fetchKontextSystemPromptMock.mockClear();
  generateJsonSummaryMock.mockClear();
  generateQaResponseMock.mockClear();
});

describe('ingest → summarize → QA pipeline', () => {
  it('ingests a reference paper and produces summary with page anchors plus QA citations', async () => {
    const paperId = '1706.03762';

    const ingestResult = await ingestPaper({ arxivId: paperId });

    expect(ingestResult.paperId).toBe(paperId);
    expect(mockStore.chunks.get(paperId)).toHaveLength(4);
    expect(ingestResult.sections).toHaveLength(3);
    expect(ingestResult.figures).toHaveLength(2);
    expect(ingestResult.refs[0]?.chunkIds?.length).toBeGreaterThan(0);

    const summary = await summarizePaper(paperId);

    expect(summary.sections.map((section) => section.section_id)).toEqual([
      'S1',
      'S2',
      'S3',
    ]);
    expect(summary.sections[0].page_anchor).toBe('(page 1)');
    expect(summary.sections[1].page_anchor).toBe('(page 3)');
    expect(summary.figures[0]?.page_anchor).toBe('(page 3)');
    expect(summary.key_findings[0]?.page_anchors).toContain('(page 3)');

    expect(fetchKontextSystemPromptMock).toHaveBeenCalledTimes(1);

    const question = 'How does self-attention improve efficiency?';
    const answer = await answerPaperQuestion(paperId, question);

    expect(answer.answer).toContain('parallel');
    expect(answer.cites[0]?.chunkId).toBe('S1-p1');
    expect(answer.cites[0]?.page).toBe(1);
    expect(answer.cites[1]?.chunkId).toBe('S2-p1');

    expect(fetchKontextSystemPromptMock).toHaveBeenCalledTimes(2);
  });

  it('applies persona guidance when enabled and alters summary and QA phrasing', async () => {
    const paperId = '1810.04805';
    await ingestPaper({ arxivId: paperId });

    const baselineSummary = await summarizePaper(paperId);
    const personaSummary = await summarizePaper(paperId, {
      personaId: 'demo-persona',
      userId: 'reader-1',
    });

    expect(personaSummary.sections[0].summary).not.toBe(
      baselineSummary.sections[0].summary,
    );
    expect(personaSummary.sections[0].summary).toContain('reusable language foundation');

    const personaSummaryCall = summaryRequests.find(
      (request) => request.paperId === paperId && request.persona === 'persona',
    );
    expect(personaSummaryCall?.systemPrompt.startsWith(PERSONA_PROMPTS['demo-persona'])).toBe(
      true,
    );

    const question = 'Which corpora power BERT pre-training?';
    const baselineAnswer = await answerPaperQuestion(paperId, question);
    const personaAnswer = await answerPaperQuestion(paperId, question, {
      personaId: 'demo-persona',
      userId: 'reader-1',
    });

    expect(personaAnswer.answer).not.toBe(baselineAnswer.answer);
    expect(personaAnswer.answer).toContain('teams');
    expect(personaAnswer.cites[0]?.page).toBe(3);

    const personaQaCall = qaRequests.find(
      (request) => request.paperId === paperId && request.persona === 'persona',
    );
    expect(personaQaCall?.systemPrompt).toContain('Persona guidance:');

    const personaKontextCalls = kontextRequests.filter(
      (call) => call.paperId === paperId && call.personaId === 'demo-persona',
    );
    expect(personaKontextCalls).toHaveLength(2);
    expect(personaKontextCalls[0]?.taskId).toBe('summarize_research_paper');
    expect(personaKontextCalls[1]?.taskId).toBe('qa_research_paper');
  });
});
