import { v5 as uuidv5 } from 'uuid';

export const READABLE_NAMESPACE_UUID = '5ddc9c5b-3a26-4b8e-9c1f-3d4a5b6c7d8e';

const buildNamespacedId = (seed: string): string =>
  uuidv5(seed, READABLE_NAMESPACE_UUID);

export const buildPaperChunkUuid = (
  paperId: string,
  chunkId: string,
): string => buildNamespacedId(`paper-chunk:${paperId}:${chunkId}`);

export const buildFigureUuid = (
  paperId: string,
  figureId: string,
): string => buildNamespacedId(`figure:${paperId}:${figureId}`);

export const buildCitationUuid = (
  paperId: string,
  citationId: string,
): string => buildNamespacedId(`citation:${paperId}:${citationId}`);

export const buildPersonaConceptUuid = (
  userId: string,
  concept: string,
): string => buildNamespacedId(`persona-concept:${userId}:${concept}`);

export const buildInteractionUuid = (
  userId: string,
  paperId: string,
  interactionType: string,
  prompt: string,
): string =>
  buildNamespacedId(
    `interaction:${userId}:${paperId}:${interactionType}:${prompt}`,
  );
