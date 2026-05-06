export * from '@/server/db/types';
export {
  upsertPaper,
  getPaper,
  upsertPaperChunks as upsertPaperChunkRecords,
  upsertFigures as upsertFigureRecords,
  upsertCitations as upsertCitationRecords,
  fetchPaperChunksByPaperId,
  fetchPaperFiguresByPaperId,
  fetchPaperCitationsByPaperId,
  searchPaperChunksByText,
  ensureSchema,
  pingPostgres,
} from '@/server/db';
export {
  upsertPersonaConcepts,
  upsertInteractions,
  upsertKontextPrompt,
  getCachedKontextPrompt,
} from '@/server/db';
export type { KontextPromptLookup } from '@/server/db';

export {
  hybridPaperChunkSearch,
  type HybridPaperChunkHit,
  type HybridPaperChunkQueryOptions,
  type HybridPaperChunkQueryResult,
} from '@/server/search/hybrid';

export {
  ensureQdrantCollection,
  upsertPaperChunkVectors,
  deletePaperChunkVectorsByPaper,
  pingQdrant,
  PAPER_CHUNK_COLLECTION,
} from '@/server/vector/qdrant';
export type { PaperChunkVectorPoint } from '@/server/vector/qdrant';
export { embedTexts, embedQuery } from '@/server/vector/embeddings';
