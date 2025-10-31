import { generateUuid5 } from 'weaviate-ts-client';

export const WEAVIATE_NAMESPACE = 'readable';

const buildNamespacedId = (seed: string): string =>
  generateUuid5(seed, WEAVIATE_NAMESPACE);

export const buildPaperChunkUuid = (
  paperId: string,
  chunkId: string,
): string => buildNamespacedId(`${paperId}:${chunkId}`);

export const buildFigureUuid = (
  paperId: string,
  figureId: string,
): string => buildNamespacedId(`${paperId}:${figureId}`);

export const buildCitationUuid = (
  paperId: string,
  citationId: string,
): string => buildNamespacedId(`${paperId}:${citationId}`);

export const buildPersonaConceptUuid = (
  userId: string,
  concept: string,
): string => buildNamespacedId(`${userId}:${concept}`);

export const buildInteractionUuid = (
  userId: string,
  paperId: string,
  interactionType: string,
  prompt: string,
): string =>
  buildNamespacedId(`${userId}:${paperId}:${interactionType}:${prompt}`);

export const buildKontextPromptUuid = (
  userId: string | undefined,
  personaId: string | undefined,
  taskId: string,
  paperId: string | undefined,
): string => {
  // Maintain deterministic UUIDs for cache lookups
  // Use consistent fallback values instead of random UUIDs
  // Note: This means missing userId/paperId will generate the same UUID,
  // which may cause cache collisions. However, determinism is required for
  // proper cache behavior. Callers should ensure userId and paperId are provided.
  const parts = [
    userId ?? 'anonymous',
    personaId ?? 'default',
    taskId,
    paperId ?? 'global',
  ];
  return buildNamespacedId(parts.join(':'));
};
