import type { WeaviateClient, WhereFilter } from 'weaviate-ts-client';

import {
  CITATION_FIELDS,
  extractAdditionalId,
  FIGURE_FIELDS,
  mapCitationBase,
  mapFigureBase,
  mapPaperChunkBase,
  PAPER_CHUNK_FIELDS,
  type CitationGraphQLRow,
  type FigureGraphQLRow,
  type PaperChunkGraphQLRow,
} from './common';
import { getWeaviateClient } from './client';
import type { Citation, Figure, PaperChunk } from './types';

const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 500;
const MAX_TOTAL_RECORDS = 5_000;

interface PaginationOptions {
  client?: WeaviateClient;
  pageSize?: number;
}

function buildPaperFilter(paperId: string): WhereFilter {
  return {
    path: ['paperId'],
    operator: 'Equal',
    valueText: paperId,
  };
}

function resolvePageSize(value: number | undefined): number {
  if (!value || Number.isNaN(value) || value <= 0) {
    return DEFAULT_PAGE_SIZE;
  }

  return Math.min(Math.floor(value), MAX_PAGE_SIZE);
}

export async function fetchPaperChunksByPaperId(
  paperId: string,
  options: PaginationOptions = {},
): Promise<PaperChunk[]> {
  const client = options.client ?? getWeaviateClient();
  const pageSize = resolvePageSize(options.pageSize);
  const whereFilter = buildPaperFilter(paperId);
  const results: PaperChunk[] = [];
  let offset = 0;

  while (true) {
    const response = await client.graphql
      .get()
      .withClassName('PaperChunk')
      .withFields(`${PAPER_CHUNK_FIELDS} _additional { id }`)
      .withWhere(whereFilter)
      .withLimit(pageSize)
      .withOffset(offset)
      .withSort([{ path: ['chunkId'], order: 'asc' }])
      .do();

    const rows =
      ((response?.data?.Get?.PaperChunk ??
        response?.data?.Get?.paperChunk) as PaperChunkGraphQLRow[]) ?? [];

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const base = mapPaperChunkBase(row);
      const id = extractAdditionalId(row._additional);

      results.push({
        ...base,
        id,
      });
    }

    if (rows.length < pageSize) {
      break;
    }

    offset += pageSize;

    if (offset >= MAX_TOTAL_RECORDS) {
      break;
    }
  }

  return results;
}

export async function fetchPaperFiguresByPaperId(
  paperId: string,
  options: PaginationOptions = {},
): Promise<Figure[]> {
  const client = options.client ?? getWeaviateClient();
  const pageSize = resolvePageSize(options.pageSize);
  const whereFilter = buildPaperFilter(paperId);
  const results: Figure[] = [];
  let offset = 0;

  while (true) {
    const response = await client.graphql
      .get()
      .withClassName('Figure')
      .withFields(`${FIGURE_FIELDS} _additional { id }`)
      .withWhere(whereFilter)
      .withLimit(pageSize)
      .withOffset(offset)
      .withSort([{ path: ['figureId'], order: 'asc' }])
      .do();

    const rows =
      ((response?.data?.Get?.Figure ??
        response?.data?.Get?.figure) as FigureGraphQLRow[]) ?? [];

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const base = mapFigureBase(row);
      const id = extractAdditionalId(row._additional);

      results.push({
        ...base,
        id,
      });
    }

    if (rows.length < pageSize) {
      break;
    }

    offset += pageSize;

    if (offset >= MAX_TOTAL_RECORDS) {
      break;
    }
  }

  return results;
}

export async function fetchPaperCitationsByPaperId(
  paperId: string,
  options: PaginationOptions = {},
): Promise<Citation[]> {
  const client = options.client ?? getWeaviateClient();
  const pageSize = resolvePageSize(options.pageSize);
  const whereFilter = buildPaperFilter(paperId);
  const results: Citation[] = [];
  let offset = 0;

  while (true) {
    const response = await client.graphql
      .get()
      .withClassName('Citation')
      .withFields(`${CITATION_FIELDS} _additional { id }`)
      .withWhere(whereFilter)
      .withLimit(pageSize)
      .withOffset(offset)
      .withSort([{ path: ['citationId'], order: 'asc' }])
      .do();

    const rows =
      ((response?.data?.Get?.Citation ??
        response?.data?.Get?.citation) as CitationGraphQLRow[]) ?? [];

    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const base = mapCitationBase(row);
      const id = extractAdditionalId(row._additional);

      results.push({
        ...base,
        id,
      });
    }

    if (rows.length < pageSize) {
      break;
    }

    offset += pageSize;

    if (offset >= MAX_TOTAL_RECORDS) {
      break;
    }
  }

  return results;
}
