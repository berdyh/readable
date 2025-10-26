import type { Citation, Figure, PaperChunk } from './types';

export const PAPER_CHUNK_FIELDS =
  'paperId chunkId text section pageNumber tokenStart tokenEnd citations figureIds';

export const FIGURE_FIELDS =
  'paperId figureId caption pageNumber imageUrl';

export const CITATION_FIELDS =
  'paperId citationId title authors year source doi url';

export interface PaperChunkGraphQLRow {
  paperId: string;
  chunkId: string;
  text: string;
  section?: string | null;
  pageNumber?: number | null;
  tokenStart?: number | null;
  tokenEnd?: number | null;
  citations?: string[] | null;
  figureIds?: string[] | null;
  _additional?: Record<string, unknown> | null;
}

export interface FigureGraphQLRow {
  paperId: string;
  figureId: string;
  caption: string;
  pageNumber?: number | null;
  imageUrl?: string | null;
  _additional?: Record<string, unknown> | null;
}

export interface CitationGraphQLRow {
  paperId: string;
  citationId: string;
  title?: string | null;
  authors?: string[] | null;
  year?: number | null;
  source?: string | null;
  doi?: string | null;
  url?: string | null;
  _additional?: Record<string, unknown> | null;
}

export function mapPaperChunkBase(
  row: PaperChunkGraphQLRow,
): PaperChunk {
  return {
    paperId: row.paperId,
    chunkId: row.chunkId,
    text: row.text,
    section: row.section ?? undefined,
    pageNumber:
      typeof row.pageNumber === 'number' ? row.pageNumber : undefined,
    tokenStart:
      typeof row.tokenStart === 'number' ? row.tokenStart : undefined,
    tokenEnd: typeof row.tokenEnd === 'number' ? row.tokenEnd : undefined,
    citations: row.citations ?? undefined,
    figureIds: row.figureIds ?? undefined,
  };
}

export function mapFigureBase(row: FigureGraphQLRow): Figure {
  return {
    paperId: row.paperId,
    figureId: row.figureId,
    caption: row.caption,
    pageNumber:
      typeof row.pageNumber === 'number' ? row.pageNumber : undefined,
    imageUrl: row.imageUrl ?? undefined,
  };
}

export function mapCitationBase(row: CitationGraphQLRow): Citation {
  return {
    paperId: row.paperId,
    citationId: row.citationId,
    title: row.title ?? undefined,
    authors: row.authors ?? undefined,
    year: typeof row.year === 'number' ? row.year : undefined,
    source: row.source ?? undefined,
    doi: row.doi ?? undefined,
    url: row.url ?? undefined,
  };
}

export function extractAdditionalId(
  additional: Record<string, unknown> | null | undefined,
): string | undefined {
  if (!additional) {
    return undefined;
  }

  const value = additional.id ?? additional['id'];

  return typeof value === 'string' && value ? value : undefined;
}
