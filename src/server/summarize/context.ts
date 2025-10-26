import { fetchArxivMetadata } from '@/server/ingest/arxiv';
import type { ArxivMetadata } from '@/server/ingest/types';
import { fetchPaperFiguresByPaperId, fetchPaperChunksByPaperId } from '@/server/weaviate/paper';
import type { Figure, PaperChunk } from '@/server/weaviate/types';

import type { PageSpan } from './types';

const MAX_PARAGRAPHS_PER_SECTION = 8;
const MAX_PARAGRAPHS_PER_FIGURE = 4;

interface SectionAccumulator {
  title: string;
  paragraphs: string[];
  pages: Set<number>;
  figureIds: Set<string>;
}

interface SectionContextRecord {
  id: string;
  title: string;
  pageSpan?: PageSpan;
  paragraphs: string[];
  referencedFigureIds: string[];
}

interface FigureAccumulator {
  figure: Figure;
  sections: Set<string>;
  paragraphs: string[];
}

export type SectionContext = SectionContextRecord;

export interface FigureContext {
  id: string;
  caption?: string;
  pageNumber?: number;
  referencedSectionIds: string[];
  supportingParagraphs: string[];
}

export interface PaperSummaryContext {
  paperId: string;
  metadata?: ArxivMetadata;
  sections: SectionContext[];
  figures: FigureContext[];
}

interface ChunkRecord {
  chunk: PaperChunk;
  sectionKey: string;
}

function normalizeSectionKey(value: string | undefined): string {
  const trimmed = (value ?? '').trim();
  return trimmed || 'General Overview';
}

function normalizeParagraph(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized || undefined;
}

function buildPageSpan(pages: Set<number>): PageSpan | undefined {
  const sorted = Array.from(pages).filter((value) => Number.isFinite(value));

  if (!sorted.length) {
    return undefined;
  }

  sorted.sort((a, b) => a - b);

  const [start] = sorted;
  const end = sorted[sorted.length - 1];

  return {
    start,
    end,
  };
}

function collectSections(
  chunks: PaperChunk[],
): { sections: SectionContext[]; chunkRecords: ChunkRecord[]; sectionKeyToId: Map<string, string> } {
  const sectionMap = new Map<string, SectionAccumulator>();
  const sectionOrder: string[] = [];
  const chunkRecords: ChunkRecord[] = [];

  for (const chunk of chunks) {
    const sectionKey = normalizeSectionKey(chunk.section);
    chunkRecords.push({ chunk, sectionKey });

    let accumulator = sectionMap.get(sectionKey);
    if (!accumulator) {
      accumulator = {
        title: sectionKey,
        paragraphs: [],
        pages: new Set<number>(),
        figureIds: new Set<string>(),
      };
      sectionMap.set(sectionKey, accumulator);
      sectionOrder.push(sectionKey);
    }

    const normalizedParagraph = normalizeParagraph(chunk.text);
    if (
      normalizedParagraph &&
      accumulator.paragraphs.length < MAX_PARAGRAPHS_PER_SECTION
    ) {
      accumulator.paragraphs.push(normalizedParagraph);
    }

    if (typeof chunk.pageNumber === 'number') {
      accumulator.pages.add(chunk.pageNumber);
    }

    (chunk.figureIds ?? []).forEach((figureId) => {
      if (figureId) {
        accumulator?.figureIds.add(figureId);
      }
    });
  }

  const sectionKeyToId = new Map<string, string>();
  const sections: SectionContext[] = sectionOrder.map((key, index) => {
    const accumulator = sectionMap.get(key);
    const id = `S${index + 1}`;
    sectionKeyToId.set(key, id);

    if (!accumulator) {
      return {
        id,
        title: key,
        pageSpan: undefined,
        paragraphs: [],
        referencedFigureIds: [],
      };
    }

    return {
      id,
      title: accumulator.title,
      pageSpan: buildPageSpan(accumulator.pages),
      paragraphs: accumulator.paragraphs.slice(),
      referencedFigureIds: Array.from(accumulator.figureIds),
    };
  });

  return { sections, chunkRecords, sectionKeyToId };
}

function collectFigures(
  figures: Figure[],
  chunkRecords: ChunkRecord[],
  sectionKeyToId: Map<string, string>,
): FigureContext[] {
  const figureMap = new Map<string, FigureAccumulator>();

  for (const figure of figures) {
    figureMap.set(figure.figureId, {
      figure,
      sections: new Set<string>(),
      paragraphs: [],
    });
  }

  for (const record of chunkRecords) {
    const sectionId = sectionKeyToId.get(record.sectionKey);
    if (!sectionId) {
      continue;
    }

    const figureIds = record.chunk.figureIds ?? [];
    if (!figureIds.length) {
      continue;
    }

    const normalizedParagraph = normalizeParagraph(record.chunk.text);

    for (const figureId of figureIds) {
      if (!figureId) {
        continue;
      }

      let accumulator = figureMap.get(figureId);
      if (!accumulator) {
        accumulator = {
          figure: {
            paperId: record.chunk.paperId,
            figureId,
            caption: '',
          },
          sections: new Set<string>(),
          paragraphs: [],
        };
        figureMap.set(figureId, accumulator);
      }

      accumulator.sections.add(sectionId);

      if (
        normalizedParagraph &&
        accumulator.paragraphs.length < MAX_PARAGRAPHS_PER_FIGURE
      ) {
        accumulator.paragraphs.push(normalizedParagraph);
      }
    }
  }

  return Array.from(figureMap.values())
    .map<FigureContext>((entry) => ({
      id: entry.figure.figureId,
      caption: entry.figure.caption,
      pageNumber: entry.figure.pageNumber,
      referencedSectionIds: Array.from(entry.sections),
      supportingParagraphs: entry.paragraphs,
    }))
    .sort((a, b) => {
      if (a.pageNumber && b.pageNumber) {
        return a.pageNumber - b.pageNumber;
      }
      if (a.pageNumber) {
        return -1;
      }
      if (b.pageNumber) {
        return 1;
      }
      return a.id.localeCompare(b.id);
    });
}

export async function loadPaperSummaryContext(
  paperId: string,
): Promise<PaperSummaryContext> {
  const [metadataResult, chunkResult, figureResult] = await Promise.allSettled([
    fetchArxivMetadata(paperId).catch((error) => {
      console.warn(
        `[summarize] Failed to fetch metadata for ${paperId}`,
        error,
      );
      return undefined;
    }),
    fetchPaperChunksByPaperId(paperId),
    fetchPaperFiguresByPaperId(paperId),
  ]);

  if (chunkResult.status !== 'fulfilled') {
    throw chunkResult.reason ?? new Error('Failed to load paper chunks.');
  }

  const chunks = chunkResult.value;

  if (!chunks.length) {
    throw new Error(
      `No content found for paper ${paperId}. Ingest the paper before summarizing.`,
    );
  }

  const metadata =
    metadataResult.status === 'fulfilled' ? metadataResult.value : undefined;
  const figures =
    figureResult.status === 'fulfilled' ? figureResult.value : [];

  const { sections, chunkRecords, sectionKeyToId } = collectSections(chunks);
  const figureContexts = collectFigures(figures, chunkRecords, sectionKeyToId);

  return {
    paperId,
    metadata,
    sections,
    figures: figureContexts,
  };
}
