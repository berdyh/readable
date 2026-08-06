import { fetchArxivMetadata } from "@/server/ingest";
import { fetchPaperFiguresByPaperId, fetchPaperChunksByPaperId, getPaper } from "@/server/db";
import type { Figure, PaperChunk } from "@/server/db";
import { getPromptLimits } from "@/server/llm-config";

import type { PageSpan } from "./types";

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
  /** Paragraphs selected by the coverage+deepening fill, in document order. */
  paragraphs: string[];
  /** How many paragraphs the section holds in storage (before budget fill). */
  referencedFigureIds: string[];
}

export type SectionContext = SectionContextRecord;

export interface FigureContext {
  id: string;
  caption?: string;
  pageNumber?: number;
  referencedSectionIds: string[];
}

export interface PaperSummaryMetadata {
  title?: string;
  abstract?: string;
  authors?: string[];
  primaryCategory?: string;
  publishedAt?: string;
  updatedAt?: string;
}

export interface SummaryCoverage {
  /** Total paragraphs stored for the paper. */
  totalParagraphs: number;
  /** Paragraphs that made it into the context under the char budget. */
  includedParagraphs: number;
  /** Char budget applied to the deepening round. */
  charBudget: number;
  truncated: boolean;
  /** Present only when truncated — rendered into the prompt so the model knows. */
  truncationNote?: string;
}

export interface PaperSummaryContext {
  paperId: string;
  metadata?: PaperSummaryMetadata;
  sections: SectionContext[];
  figures: FigureContext[];
  coverage: SummaryCoverage;
}

interface ChunkRecord {
  chunk: PaperChunk;
  sectionKey: string;
}

export interface LoadPaperSummaryContextOptions {
  /** Overrides the config-driven context char budget (mainly for tests). */
  charBudget?: number;
}

function normalizeSectionKey(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  return trimmed || "General Overview";
}

function normalizeParagraph(text: string | undefined): string | undefined {
  if (!text) {
    return undefined;
  }

  const normalized = text.replace(/\s+/g, " ").trim();
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

interface ParagraphCandidate {
  sectionKey: string;
  /** Position within the section, so selected paragraphs re-render in document order. */
  index: number;
  text: string;
}

/**
 * Coverage + deepening fill.
 *
 * Round 1 (coverage): every section contributes its lead paragraph
 * unconditionally, so no part of the paper is silently invisible to the
 * model — the defect this replaces dropped Training/Results/Conclusion
 * entirely.
 *
 * Round 2 (deepening): the remaining paragraphs across all sections,
 * longest first, are added while the total stays under the char budget.
 * Selected paragraphs are re-emitted in document order within their
 * section.
 */
function selectParagraphsUnderBudget(
  sectionOrder: string[],
  sectionParagraphs: Map<string, string[]>,
  charBudget: number,
): { selected: Map<string, string[]>; coverage: SummaryCoverage } {
  const selected = new Map<string, Set<number>>();
  let usedChars = 0;
  let totalParagraphs = 0;

  const deepeningCandidates: ParagraphCandidate[] = [];

  for (const key of sectionOrder) {
    const paragraphs = sectionParagraphs.get(key) ?? [];
    totalParagraphs += paragraphs.length;
    const picks = new Set<number>();

    if (paragraphs.length > 0) {
      picks.add(0);
      usedChars += paragraphs[0].length;
    }

    for (let index = 1; index < paragraphs.length; index += 1) {
      deepeningCandidates.push({ sectionKey: key, index, text: paragraphs[index] });
    }

    selected.set(key, picks);
  }

  deepeningCandidates.sort((a, b) => b.text.length - a.text.length);

  let includedParagraphs = sectionOrder.reduce(
    (count, key) => count + (selected.get(key)?.size ?? 0),
    0,
  );

  for (const candidate of deepeningCandidates) {
    if (usedChars + candidate.text.length > charBudget) {
      continue;
    }
    selected.get(candidate.sectionKey)?.add(candidate.index);
    usedChars += candidate.text.length;
    includedParagraphs += 1;
  }

  const truncated = includedParagraphs < totalParagraphs;

  const orderedSelection = new Map<string, string[]>();
  for (const key of sectionOrder) {
    const paragraphs = sectionParagraphs.get(key) ?? [];
    const picks = selected.get(key) ?? new Set<number>();
    orderedSelection.set(
      key,
      paragraphs.filter((_, index) => picks.has(index)),
    );
  }

  return {
    selected: orderedSelection,
    coverage: {
      totalParagraphs,
      includedParagraphs,
      charBudget,
      truncated,
      truncationNote: truncated
        ? `Input truncated to fit the context budget: ${includedParagraphs} of ${totalParagraphs} paragraphs included. Every section keeps its lead paragraph; deepening preferred longer passages.`
        : undefined,
    },
  };
}

function collectSections(
  chunks: PaperChunk[],
  charBudget: number,
): {
  sections: SectionContext[];
  chunkRecords: ChunkRecord[];
  sectionKeyToId: Map<string, string>;
  coverage: SummaryCoverage;
} {
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
    if (normalizedParagraph) {
      accumulator.paragraphs.push(normalizedParagraph);
    }

    if (typeof chunk.pageNumber === "number") {
      accumulator.pages.add(chunk.pageNumber);
    }

    (chunk.figureIds ?? []).forEach((figureId) => {
      if (figureId) {
        accumulator?.figureIds.add(figureId);
      }
    });
  }

  const sectionParagraphs = new Map<string, string[]>();
  for (const key of sectionOrder) {
    sectionParagraphs.set(key, sectionMap.get(key)?.paragraphs ?? []);
  }

  const { selected, coverage } = selectParagraphsUnderBudget(
    sectionOrder,
    sectionParagraphs,
    charBudget,
  );

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
      paragraphs: selected.get(key) ?? [],
      referencedFigureIds: Array.from(accumulator.figureIds),
    };
  });

  return { sections, chunkRecords, sectionKeyToId, coverage };
}

/**
 * Figure contexts carry the caption plus which sections reference them —
 * and nothing else. They used to also carry "supporting paragraphs" that
 * were verbatim copies of section text already in the prompt (measured:
 * 100% duplication), so that block is gone.
 */
function collectFigures(
  figures: Figure[],
  chunkRecords: ChunkRecord[],
  sectionKeyToId: Map<string, string>,
): FigureContext[] {
  const referencedSections = new Map<string, Set<string>>();
  const knownFigures = new Map<string, Figure>();

  for (const figure of figures) {
    knownFigures.set(figure.figureId, figure);
    referencedSections.set(figure.figureId, new Set<string>());
  }

  for (const record of chunkRecords) {
    const sectionId = sectionKeyToId.get(record.sectionKey);
    if (!sectionId) {
      continue;
    }

    for (const figureId of record.chunk.figureIds ?? []) {
      if (!figureId) {
        continue;
      }

      let sections = referencedSections.get(figureId);
      if (!sections) {
        sections = new Set<string>();
        referencedSections.set(figureId, sections);
      }
      sections.add(sectionId);
    }
  }

  return Array.from(referencedSections.entries())
    .map<FigureContext>(([figureId, sections]) => {
      const figure = knownFigures.get(figureId);
      return {
        id: figureId,
        caption: figure?.caption,
        pageNumber: figure?.pageNumber,
        referencedSectionIds: Array.from(sections),
      };
    })
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

function hasCompleteMetadata(metadata: PaperSummaryMetadata | undefined): boolean {
  return Boolean(metadata?.title && metadata.abstract && metadata.authors?.length);
}

/**
 * DB-first metadata: the `papers` row is authoritative; the live arXiv
 * API is only consulted when stored fields are missing (Issue 8 — the
 * old code live-fetched arXiv on every summarize request).
 */
async function loadMetadata(paperId: string): Promise<PaperSummaryMetadata | undefined> {
  let stored: PaperSummaryMetadata | undefined;
  try {
    const record = await getPaper(paperId);
    if (record) {
      stored = {
        title: record.title,
        abstract: record.abstract,
        authors: record.authors,
        primaryCategory: record.primaryCategory,
        publishedAt: record.publishedAt,
        updatedAt: record.updatedAt,
      };
    }
  } catch (error) {
    console.warn(`[summarize] Failed to read stored metadata for ${paperId}`, error);
  }

  if (hasCompleteMetadata(stored)) {
    return stored;
  }

  try {
    const fetched = await fetchArxivMetadata(paperId);
    if (!fetched) {
      return stored;
    }
    return {
      title: stored?.title ?? fetched.title,
      abstract: stored?.abstract ?? fetched.abstract,
      authors: stored?.authors?.length ? stored.authors : fetched.authors,
      primaryCategory: stored?.primaryCategory ?? fetched.primaryCategory,
      publishedAt: stored?.publishedAt ?? fetched.publishedAt,
      updatedAt: stored?.updatedAt ?? fetched.updatedAt,
    };
  } catch (error) {
    console.warn(`[summarize] Failed to fetch metadata for ${paperId}`, error);
    return stored;
  }
}

export async function loadPaperSummaryContext(
  paperId: string,
  options: LoadPaperSummaryContextOptions = {},
): Promise<PaperSummaryContext> {
  const charBudget = options.charBudget ?? getPromptLimits().context_char_budget;

  const [metadataResult, chunkResult, figureResult] = await Promise.allSettled([
    loadMetadata(paperId),
    fetchPaperChunksByPaperId(paperId),
    fetchPaperFiguresByPaperId(paperId),
  ]);

  if (chunkResult.status !== "fulfilled") {
    throw chunkResult.reason ?? new Error("Failed to load paper chunks.");
  }

  const chunks = chunkResult.value;

  if (!chunks.length) {
    throw new Error(`No content found for paper ${paperId}. Ingest the paper before summarizing.`);
  }

  const metadata = metadataResult.status === "fulfilled" ? metadataResult.value : undefined;
  const figures = figureResult.status === "fulfilled" ? figureResult.value : [];

  const { sections, chunkRecords, sectionKeyToId, coverage } = collectSections(chunks, charBudget);
  const figureContexts = collectFigures(figures, chunkRecords, sectionKeyToId);

  return {
    paperId,
    metadata,
    sections,
    figures: figureContexts,
    coverage,
  };
}
