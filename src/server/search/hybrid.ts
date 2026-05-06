import {
  fetchChunksByIds,
  fetchChunksByPageWindow,
  searchPaperChunksByText,
  type PaperChunk,
  type PaperChunkTextSearchHit,
} from '@/server/db';
import { embedQuery } from '@/server/vector/embeddings';
import {
  searchPaperChunkVectors,
  type QdrantSearchHit,
} from '@/server/vector/qdrant';

export interface HybridPaperChunkQueryOptions {
  paperId: string;
  query: string;
  limit?: number;
  alpha?: number;
  pageWindow?: number;
  vector?: number[];
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

const DEFAULT_LIMIT = 10;
const DEFAULT_ALPHA = 0.65;
const RRF_K = 60;

interface ScoredItem {
  id: string;
  score: number;
  vectorScore?: number;
  textScore?: number;
  vectorRank?: number;
  textRank?: number;
}

function combineRanks(
  vectorHits: QdrantSearchHit[],
  textHits: PaperChunkTextSearchHit[],
  alpha: number,
): ScoredItem[] {
  const scores = new Map<string, ScoredItem>();

  vectorHits.forEach((hit, index) => {
    const rrf = 1 / (RRF_K + index + 1);
    const entry = scores.get(hit.id) ?? { id: hit.id, score: 0 };
    entry.vectorScore = hit.score;
    entry.vectorRank = index + 1;
    entry.score += alpha * rrf;
    scores.set(hit.id, entry);
  });

  textHits.forEach((hit, index) => {
    const rrf = 1 / (RRF_K + index + 1);
    const entry = scores.get(hit.id) ?? { id: hit.id, score: 0 };
    entry.textScore = hit.rank;
    entry.textRank = index + 1;
    entry.score += (1 - alpha) * rrf;
    scores.set(hit.id, entry);
  });

  return Array.from(scores.values()).sort((a, b) => b.score - a.score);
}

function buildHitFromChunk(
  chunk: PaperChunk,
  scored: ScoredItem | undefined,
): HybridPaperChunkHit {
  return {
    id: chunk.id ?? '',
    paperId: chunk.paperId,
    chunkId: chunk.chunkId,
    text: chunk.text,
    section: chunk.section,
    pageNumber: chunk.pageNumber,
    score: scored?.score,
    distance: scored?.vectorScore !== undefined ? 1 - scored.vectorScore : undefined,
    citations: chunk.citations ? [...chunk.citations] : [],
    figureIds: chunk.figureIds ? [...chunk.figureIds] : [],
    additional: scored
      ? {
          score: scored.score,
          vectorScore: scored.vectorScore,
          textScore: scored.textScore,
          vectorRank: scored.vectorRank,
          textRank: scored.textRank,
        }
      : undefined,
  };
}

async function runVectorSearch(
  paperId: string,
  query: string,
  vector: number[] | undefined,
  limit: number,
): Promise<QdrantSearchHit[]> {
  let queryVector = vector;

  if (!queryVector || queryVector.length === 0) {
    try {
      queryVector = await embedQuery(query);
    } catch (error) {
      console.warn('[hybrid] Embedding generation failed; falling back to text-only search.', error);
      return [];
    }
  }

  if (!queryVector?.length) {
    return [];
  }

  try {
    return await searchPaperChunkVectors({
      paperId,
      vector: queryVector,
      limit,
    });
  } catch (error) {
    console.warn('[hybrid] Qdrant search failed; falling back to text-only.', error);
    return [];
  }
}

export async function hybridPaperChunkSearch(
  options: HybridPaperChunkQueryOptions,
): Promise<HybridPaperChunkQueryResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const alpha = options.alpha ?? DEFAULT_ALPHA;
  const fetchLimit = Math.max(limit * 3, limit + 5);

  const [vectorHits, textHits] = await Promise.all([
    runVectorSearch(options.paperId, options.query, options.vector, fetchLimit),
    searchPaperChunksByText(options.paperId, options.query, fetchLimit),
  ]);

  const ranked = combineRanks(vectorHits, textHits, alpha).slice(0, limit);

  if (ranked.length === 0) {
    return { hits: [], expandedWindow: [] };
  }

  const chunkRecords = await fetchChunksByIds(ranked.map((entry) => entry.id));
  const chunkMap = new Map(chunkRecords.map((chunk) => [chunk.id ?? '', chunk]));

  const hits: HybridPaperChunkHit[] = [];
  for (const entry of ranked) {
    const chunk = chunkMap.get(entry.id);
    if (chunk) {
      hits.push(buildHitFromChunk(chunk, entry));
    }
  }

  if (!options.pageWindow || options.pageWindow <= 0) {
    return { hits, expandedWindow: [] };
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

  if (targetPages.size === 0) {
    return { hits, expandedWindow: [] };
  }

  const windowChunks = await fetchChunksByPageWindow(
    options.paperId,
    Array.from(targetPages),
  );

  const seen = new Set(hits.map((hit) => hit.id));
  const expandedWindow: HybridPaperChunkHit[] = [];
  for (const chunk of windowChunks) {
    const id = chunk.id ?? '';
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    expandedWindow.push(buildHitFromChunk(chunk, undefined));
  }

  return { hits, expandedWindow };
}
