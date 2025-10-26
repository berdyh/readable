import type { WeaviateClient, WhereFilter } from 'weaviate-ts-client';
import { FusionType } from 'weaviate-ts-client';

import { extractAdditionalId, mapPaperChunkBase, PAPER_CHUNK_FIELDS, type PaperChunkGraphQLRow } from './common';
import { getWeaviateClient } from './client';

export interface HybridPaperChunkQueryOptions {
  paperId: string;
  query: string;
  limit?: number;
  offset?: number;
  alpha?: number;
  vector?: number[];
  properties?: string[];
  pageWindow?: number;
  additionalFields?: string[];
}

export interface HybridPaperChunkHit {
  id: string;
  paperId: string;
  chunkId: string;
  text: string;
  section?: string;
  pageNumber?: number;
  score?: number;
  distance?: number;
  citations?: string[];
  figureIds?: string[];
  additional?: Record<string, unknown>;
}

export interface HybridPaperChunkQueryResult {
  hits: HybridPaperChunkHit[];
  expandedWindow: HybridPaperChunkHit[];
}

function mapHybridHit(item: PaperChunkGraphQLRow): HybridPaperChunkHit {
  const base = mapPaperChunkBase(item);
  const additional = (item._additional ?? {}) as Record<string, unknown>;

  return {
    id: extractAdditionalId(additional) ?? '',
    paperId: base.paperId,
    chunkId: base.chunkId,
    text: base.text,
    section: base.section,
    pageNumber: base.pageNumber,
    score:
      typeof additional.score === 'number'
        ? additional.score
        : additional?.score
        ? Number(additional.score)
        : undefined,
    distance:
      typeof additional.distance === 'number'
        ? additional.distance
        : additional?.distance
        ? Number(additional.distance)
        : undefined,
    citations: base.citations,
    figureIds: base.figureIds,
    additional,
  };
}

function uniqueById(items: HybridPaperChunkHit[]): HybridPaperChunkHit[] {
  const seen = new Set<string>();
  const result: HybridPaperChunkHit[] = [];

  for (const item of items) {
    if (seen.has(item.id)) {
      continue;
    }

    seen.add(item.id);
    result.push(item);
  }

  return result;
}

function buildPaperWindowFilter(
  paperId: string,
  minPage: number,
  maxPage: number,
): WhereFilter {
  return {
    operator: 'And',
    operands: [
      {
        path: ['paperId'],
        operator: 'Equal',
        valueText: paperId,
      },
      {
        operator: 'And',
        operands: [
          {
            path: ['pageNumber'],
            operator: 'GreaterThanEqual',
            valueInt: minPage,
          },
          {
            path: ['pageNumber'],
            operator: 'LessThanEqual',
            valueInt: maxPage,
          },
        ],
      },
    ],
  };
}

async function runPaperChunkHybridQuery(
  client: WeaviateClient,
  options: HybridPaperChunkQueryOptions,
): Promise<HybridPaperChunkHit[]> {
  const whereFilter: WhereFilter = {
    path: ['paperId'],
    operator: 'Equal',
    valueText: options.paperId,
  };

  const additionalFieldSet = new Set<string>([
    'id',
    'score',
    'distance',
    ...(options.additionalFields ?? []),
  ]);
  const additionalClause = `_additional { ${Array.from(additionalFieldSet).join(
    ' ',
  )} }`;

  const response = await client.graphql
    .get()
    .withClassName('PaperChunk')
    .withFields(`${PAPER_CHUNK_FIELDS} ${additionalClause}`)
    .withWhere(whereFilter)
    .withLimit(options.limit ?? 10)
    .withOffset(options.offset ?? 0)
    .withHybrid({
      query: options.query,
      vector: options.vector,
      properties: options.properties,
      alpha: options.alpha,
      fusionType: FusionType.rankedFusion,
    })
    .do();

  const rawItems =
    (response?.data?.Get?.PaperChunk ??
      response?.data?.Get?.paperChunk ??
      []) as PaperChunkGraphQLRow[];

  return rawItems.map(mapHybridHit);
}

async function runPaperWindowExpansion(
  client: WeaviateClient,
  paperId: string,
  pages: Set<number>,
  limit: number,
): Promise<HybridPaperChunkHit[]> {
  if (pages.size === 0) {
    return [];
  }

  const min = Math.min(...pages);
  const max = Math.max(...pages);

  const additionalClause = '_additional { id score distance }';

  const windowResponse = await client.graphql
    .get()
    .withClassName('PaperChunk')
    .withFields(`${PAPER_CHUNK_FIELDS} ${additionalClause}`)
    .withWhere(buildPaperWindowFilter(paperId, min, max))
    .withLimit(limit)
    .do();

  const rawItems =
    (windowResponse?.data?.Get?.PaperChunk ??
      windowResponse?.data?.Get?.paperChunk ??
      []) as PaperChunkGraphQLRow[];

  const mapped = rawItems.map(mapHybridHit);

  return mapped.filter(
    (item) =>
      item.pageNumber !== undefined && pages.has(Number(item.pageNumber)),
  );
}

export async function hybridPaperChunkSearch(
  options: HybridPaperChunkQueryOptions,
  client: WeaviateClient = getWeaviateClient(),
): Promise<HybridPaperChunkQueryResult> {
  const hits = await runPaperChunkHybridQuery(client, options);

  if (!options.pageWindow || options.pageWindow <= 0) {
    return {
      hits,
      expandedWindow: [],
    };
  }

  const targetPages = new Set<number>();

  for (const hit of hits) {
    if (typeof hit.pageNumber !== 'number') {
      continue;
    }

    for (
      let page = hit.pageNumber - options.pageWindow;
      page <= hit.pageNumber + options.pageWindow;
      page += 1
    ) {
      if (page >= 0) {
        targetPages.add(page);
      }
    }
  }

  const expandedWindow = await runPaperWindowExpansion(
    client,
    options.paperId,
    targetPages,
    Math.min(100, (options.limit ?? 10) * (options.pageWindow + 1)),
  );

  const dedupedExpanded = uniqueById(
    expandedWindow.filter(
      (item) => !hits.find((hit) => hit.id === item.id),
    ),
  );

  return {
    hits,
    expandedWindow: dedupedExpanded,
  };
}
