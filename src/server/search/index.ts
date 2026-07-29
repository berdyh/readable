/**
 * Public surface of the search module.
 *
 * One entry point. The vector/full-text split and the RRF fusion behind it are
 * internal — callers get a single ranked hit list plus the diagnostics that say
 * how degraded the retrieval was.
 */
export { hybridPaperChunkSearch } from "./hybrid";
export type {
  HybridPaperChunkHit,
  HybridPaperChunkQueryOptions,
  HybridPaperChunkQueryResult,
  HybridRetrievalDiagnostics,
  HybridTextRetrievalStatus,
  HybridVectorRetrievalStatus,
} from "./hybrid";
