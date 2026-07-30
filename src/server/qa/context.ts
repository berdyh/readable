import {
  fetchPaperCitationsByPaperId,
  fetchPaperFiguresByPaperId,
  type Citation,
  type Figure,
} from "@/server/db";
import { hybridPaperChunkSearch, type HybridPaperChunkHit } from "@/server/search";

import type {
  NormalizedSelection,
  QaCitationContext,
  QaChunkContext,
  QaFigureContext,
  QuestionEvidenceContext,
  QuestionOptions,
  QuestionSelection,
} from "./types";

const DEFAULT_HYBRID_LIMIT = 8;
const DEFAULT_HYBRID_ALPHA = 0.65;
const DEFAULT_PAGE_WINDOW = 1;
const MAX_CITATIONS_IN_CONTEXT = 4;

function normalizeTextValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizeSelection(selection?: QuestionSelection): NormalizedSelection | undefined {
  if (!selection) {
    return undefined;
  }

  const text = normalizeTextValue(selection.text);
  const section = normalizeTextValue(selection.section);
  const page =
    typeof selection.page === "number" && Number.isFinite(selection.page)
      ? selection.page
      : undefined;

  if (!text && !section && page === undefined) {
    return undefined;
  }

  return {
    text,
    section,
    page,
  };
}

function buildHybridQuery(question: string, selection: NormalizedSelection | undefined): string {
  const parts = [question.trim()];

  if (selection?.text) {
    parts.push(selection.text);
  }

  return parts.join(" ").trim();
}

function mapHybridHit(hit: HybridPaperChunkHit): QaChunkContext {
  return {
    id: hit.id,
    chunkId: hit.chunkId,
    text: hit.text,
    section: hit.section,
    pageNumber: hit.pageNumber,
    score: hit.score,
    distance: hit.distance,
    citations: [...(hit.citations ?? [])],
    figureIds: [...(hit.figureIds ?? [])],
  };
}

function collectFigureIds(chunks: QaChunkContext[]): Set<string> {
  const ids = new Set<string>();

  for (const chunk of chunks) {
    for (const figureId of chunk.figureIds) {
      if (figureId) {
        ids.add(figureId);
      }
    }
  }

  return ids;
}

function collectCitationCounts(chunks: QaChunkContext[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const chunk of chunks) {
    for (const citationIdRaw of chunk.citations) {
      const citationId = citationIdRaw?.trim();
      if (!citationId) {
        continue;
      }

      counts.set(citationId, (counts.get(citationId) ?? 0) + 1);
    }
  }

  return counts;
}

function mapFigureToContext(figure: Figure | undefined): QaFigureContext | undefined {
  if (!figure) {
    return undefined;
  }

  return {
    figureId: figure.figureId,
    caption: figure.caption,
    pageNumber: figure.pageNumber,
    imageUrl: figure.imageUrl,
  };
}

/**
 * Citation context comes from Postgres only (S2 hygiene): enrichment —
 * abstract, venue, citation counts, arXiv ids — was persisted at ingest.
 * The QA hot path no longer calls arXiv or Semantic Scholar.
 */
function mapCitationToContext(
  citationId: string,
  citation: Citation | undefined,
): QaCitationContext {
  return {
    citationId,
    title: citation?.title,
    authors: citation?.authors,
    year: citation?.year,
    source: citation?.source ?? citation?.venue,
    doi: citation?.doi,
    url: citation?.url ?? citation?.openAccessPdfUrl,
    arxivId: citation?.arxivId,
    abstract: citation?.abstract,
    citationCount: citation?.citationCount,
  };
}

async function collectRelevantFigures(
  paperId: string,
  chunks: QaChunkContext[],
): Promise<QaFigureContext[]> {
  const figureIds = collectFigureIds(chunks);
  if (figureIds.size === 0) {
    return [];
  }

  const figures = await fetchPaperFiguresByPaperId(paperId);
  const figureMap = new Map<string, Figure>();
  for (const figure of figures) {
    figureMap.set(figure.figureId, figure);
  }

  const relevant: QaFigureContext[] = [];
  for (const figureId of figureIds) {
    const figure = figureMap.get(figureId);
    const context = mapFigureToContext(figure);
    if (context) {
      relevant.push(context);
    }
  }

  return relevant;
}

async function collectRelevantCitations(
  paperId: string,
  chunks: QaChunkContext[],
): Promise<QaCitationContext[]> {
  const citationCounts = collectCitationCounts(chunks);
  if (citationCounts.size === 0) {
    return [];
  }

  const sorted = Array.from(citationCounts.entries()).sort((a, b) => b[1] - a[1]);
  const candidates = sorted.slice(0, MAX_CITATIONS_IN_CONTEXT).map(([citationId]) => citationId);

  const citations = await fetchPaperCitationsByPaperId(paperId);
  const citationMap = new Map<string, Citation>();
  for (const citation of citations) {
    citationMap.set(citation.citationId, citation);
  }

  return candidates.map((citationId) =>
    mapCitationToContext(citationId, citationMap.get(citationId)),
  );
}

export async function loadQuestionEvidence(
  paperId: string,
  question: string,
  options: QuestionOptions = {},
): Promise<QuestionEvidenceContext> {
  const normalizedQuestion = normalizeTextValue(question);
  if (!normalizedQuestion) {
    throw new Error("Question text is required.");
  }

  const selection = normalizeSelection(options.selection);
  const query = buildHybridQuery(normalizedQuestion, selection);

  const { hits, expandedWindow, retrieval } = await hybridPaperChunkSearch({
    paperId,
    query,
    limit: options.limit ?? DEFAULT_HYBRID_LIMIT,
    alpha: options.alpha ?? DEFAULT_HYBRID_ALPHA,
    pageWindow: DEFAULT_PAGE_WINDOW,
  });

  const mappedHits = hits.map(mapHybridHit);
  const mappedWindow = expandedWindow.map(mapHybridHit);
  const combinedChunks = [...mappedHits, ...mappedWindow];

  const [figures, citations] = await Promise.all([
    collectRelevantFigures(paperId, combinedChunks),
    collectRelevantCitations(paperId, combinedChunks),
  ]);

  return {
    paperId,
    query,
    hits: mappedHits,
    expandedWindow: mappedWindow,
    figures,
    citations,
    retrieval,
    selection,
  };
}
