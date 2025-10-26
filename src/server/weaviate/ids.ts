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
