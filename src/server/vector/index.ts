/**
 * Public surface of the vector module.
 *
 * Collections are per embedding provider+model, so callers never name a
 * collection directly — `ensureQdrantCollection()` resolves it from the active
 * embedding environment.
 */
export {
  embedQuery,
  embedTexts,
  getEmbeddingEnvironment,
  probeEmbeddingDimensions,
} from "./embeddings";
export type { EmbeddingEnvironmentConfig, EmbeddingProviderId } from "./embeddings";

export {
  deletePaperChunkVectorsByPaper,
  ensureQdrantCollection,
  pingQdrant,
  searchPaperChunkVectors,
  upsertPaperChunkVectors,
} from "./qdrant";
export type { PaperChunkVectorPoint, QdrantSearchHit } from "./qdrant";
