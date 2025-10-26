import type { WeaviateClient, WeaviateObject } from 'weaviate-ts-client';
import { generateUuid5 } from 'weaviate-ts-client';

import { getWeaviateClient } from './client';
import type {
  Citation,
  Figure,
  Interaction,
  PaperChunk,
  PersonaConcept,
} from './types';

interface BatchUpsertResult {
  id: string;
  status: 'SUCCESS' | 'FAILED';
  error?: string;
}

const CLEAN_NAMESPACE = 'readable';

const removeUndefined = (
  payload: Record<string, unknown>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined || value === null) {
      continue;
    }

    next[key] = value;
  }

  return next;
};

const formatReferences = (ids: string[] | undefined, className: string) => {
  if (!ids?.length) {
    return undefined;
  }

  return ids.map((id) => ({
    beacon: `weaviate://localhost/${className}/${id}`,
  }));
};

async function batchUpsert(
  client: WeaviateClient,
  objects: WeaviateObject[],
): Promise<BatchUpsertResult[]> {
  if (objects.length === 0) {
    return [];
  }

  const response = await client.batch.objectsBatcher().withObjects(...objects).do();

  return response.map((item) => {
    const errorDetails = item.result?.errors?.error;
    let errorMessage: string | undefined;

    if (typeof errorDetails === 'string') {
      errorMessage = errorDetails;
    } else if (Array.isArray(errorDetails)) {
      errorMessage = errorDetails
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return String(entry);
          }

          if ('message' in entry && typeof entry.message === 'string') {
            return entry.message;
          }

          return JSON.stringify(entry);
        })
        .join('; ');
    }

    return {
      id: item.id ?? '',
      status: item.result?.status === 'SUCCESS' ? 'SUCCESS' : 'FAILED',
      error: errorMessage,
    } satisfies BatchUpsertResult;
  });
}

const buildPaperChunkObject = (chunk: PaperChunk): WeaviateObject => {
  const id =
    chunk.id ??
    generateUuid5(`${chunk.paperId}:${chunk.chunkId}`, CLEAN_NAMESPACE);

  return {
    class: 'PaperChunk',
    id,
    properties: removeUndefined({
      paperId: chunk.paperId,
      chunkId: chunk.chunkId,
      text: chunk.text,
      section: chunk.section,
      pageNumber: chunk.pageNumber,
      tokenStart: chunk.tokenStart,
      tokenEnd: chunk.tokenEnd,
      citations: chunk.citations,
      figureIds: chunk.figureIds,
    }),
  };
};

const buildFigureObject = (figure: Figure): WeaviateObject => {
  const id =
    figure.id ??
    generateUuid5(`${figure.paperId}:${figure.figureId}`, CLEAN_NAMESPACE);

  return {
    class: 'Figure',
    id,
    properties: removeUndefined({
      paperId: figure.paperId,
      figureId: figure.figureId,
      caption: figure.caption,
      pageNumber: figure.pageNumber,
      imageUrl: figure.imageUrl,
      chunks: formatReferences(figure.chunkIds, 'PaperChunk'),
    }),
  };
};

const buildCitationObject = (citation: Citation): WeaviateObject => {
  const id =
    citation.id ??
    generateUuid5(
      `${citation.paperId}:${citation.citationId}`,
      CLEAN_NAMESPACE,
    );

  return {
    class: 'Citation',
    id,
    properties: removeUndefined({
      paperId: citation.paperId,
      citationId: citation.citationId,
      title: citation.title,
      authors: citation.authors,
      year: citation.year,
      source: citation.source,
      doi: citation.doi,
      url: citation.url,
      chunks: formatReferences(citation.chunkIds, 'PaperChunk'),
    }),
  };
};

const buildPersonaConceptObject = (
  concept: PersonaConcept,
): WeaviateObject => {
  const id =
    concept.id ??
    generateUuid5(`${concept.userId}:${concept.concept}`, CLEAN_NAMESPACE);

  return {
    class: 'PersonaConcept',
    id,
    properties: removeUndefined({
      userId: concept.userId,
      concept: concept.concept,
      description: concept.description,
      firstSeenPaperId: concept.firstSeenPaperId,
      learnedAt: concept.learnedAt,
      confidence: concept.confidence,
    }),
  };
};

const buildInteractionObject = (interaction: Interaction): WeaviateObject => {
  const id =
    interaction.id ??
    generateUuid5(
      `${interaction.userId}:${interaction.paperId}:${interaction.interactionType}:${interaction.prompt}`,
      CLEAN_NAMESPACE,
    );

  return {
    class: 'Interaction',
    id,
    properties: removeUndefined({
      userId: interaction.userId,
      paperId: interaction.paperId,
      interactionType: interaction.interactionType,
      prompt: interaction.prompt,
      response: interaction.response,
      createdAt: interaction.createdAt,
      chunks: formatReferences(interaction.chunkIds, 'PaperChunk'),
      personaConcepts: formatReferences(
        interaction.personaConceptIds,
        'PersonaConcept',
      ),
    }),
  };
};

function ensureNoFailures(result: BatchUpsertResult[], label: string) {
  const failures = result.filter((item) => item.status === 'FAILED');

  if (failures.length > 0) {
    const messages = failures
      .map((failure) => `${failure.id}: ${failure.error ?? 'Unknown error'}`)
      .join('\n');

    throw new Error(`Failed to upsert ${label}:\n${messages}`);
  }
}

export async function upsertPaperChunks(
  chunks: PaperChunk[],
  client: WeaviateClient = getWeaviateClient(),
): Promise<string[]> {
  const result = await batchUpsert(
    client,
    chunks.map(buildPaperChunkObject),
  );
  ensureNoFailures(result, 'PaperChunk');
  return result.map((item) => item.id);
}

export async function upsertFigures(
  figures: Figure[],
  client: WeaviateClient = getWeaviateClient(),
): Promise<string[]> {
  const result = await batchUpsert(
    client,
    figures.map(buildFigureObject),
  );
  ensureNoFailures(result, 'Figure');
  return result.map((item) => item.id);
}

export async function upsertCitations(
  citations: Citation[],
  client: WeaviateClient = getWeaviateClient(),
): Promise<string[]> {
  const result = await batchUpsert(
    client,
    citations.map(buildCitationObject),
  );
  ensureNoFailures(result, 'Citation');
  return result.map((item) => item.id);
}

export async function upsertPersonaConcepts(
  concepts: PersonaConcept[],
  client: WeaviateClient = getWeaviateClient(),
): Promise<string[]> {
  const result = await batchUpsert(
    client,
    concepts.map(buildPersonaConceptObject),
  );
  ensureNoFailures(result, 'PersonaConcept');
  return result.map((item) => item.id);
}

export async function upsertInteractions(
  interactions: Interaction[],
  client: WeaviateClient = getWeaviateClient(),
): Promise<string[]> {
  const result = await batchUpsert(
    client,
    interactions.map(buildInteractionObject),
  );
  ensureNoFailures(result, 'Interaction');
  return result.map((item) => item.id);
}
