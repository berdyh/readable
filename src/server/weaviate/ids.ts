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
): string | null => {
  // Require userId and paperId to prevent cache collisions and ensure proper isolation
  // Missing parameters would cause all anonymous users to share the same UUID,
  // breaking cache isolation and potentially serving one user's prompt to another
  // Return null to signal that caching should be skipped (callers should check for null)
  if (!userId || !paperId) {
    // Cannot generate a safe UUID without both userId and paperId
    // This prevents cache collisions while maintaining determinism for valid inputs
    return null;
  }
  
  // All required parameters present - generate deterministic UUID
  const parts = [
    userId,
    personaId ?? 'default',
    taskId,
    paperId,
  ];
  return buildNamespacedId(parts.join(':'));
};
