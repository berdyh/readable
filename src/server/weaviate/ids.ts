import { generateUuid5 } from 'weaviate-ts-client';
import { randomUUID } from 'crypto';

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
  // If critical parameters are missing, use random UUID to prevent collisions
  // instead of deterministic fallback values that would cause cache collisions
  if (!userId || !paperId) {
    // Use randomUUID() for missing parameters to ensure uniqueness
    // This prevents different users (both undefined) from generating the same UUID
    const randomSuffix = randomUUID();
    const parts = [
      userId ?? `anonymous-${randomSuffix}`,
      personaId ?? `default-${randomSuffix}`,
      taskId,
      paperId ?? `global-${randomSuffix}`,
    ];
    return buildNamespacedId(parts.join(':'));
  }
  
  // All required parameters present - use deterministic UUID
  const parts = [
    userId,
    personaId ?? 'default',
    taskId,
    paperId,
  ];
  return buildNamespacedId(parts.join(':'));
};
