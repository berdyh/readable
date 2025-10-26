import type { Property, WeaviateClass, WeaviateClient } from 'weaviate-ts-client';

import { getWeaviateClient, verifyWeaviateConnection } from './client';

const TEXT_MODULE = 'text2vec-openai';

const defaultTextProperty = (
  name: string,
  description: string,
  overrides: Partial<Property> = {},
): Property => ({
  name,
  description,
  dataType: ['text'],
  tokenization: 'word',
  ...overrides,
});

const classes: WeaviateClass[] = [
  {
    class: 'PaperChunk',
    description: 'Semantic chunk of a research paper used for retrieval.',
    vectorizer: TEXT_MODULE,
    moduleConfig: {
      [TEXT_MODULE]: {
        vectorizeClassName: false,
      },
    },
    vectorIndexConfig: {
      distance: 'cosine',
    },
    invertedIndexConfig: {
      bm25: {
        k1: 1.2,
        b: 0.75,
      },
    },
    properties: [
      defaultTextProperty('paperId', 'Unique identifier for the paper.'),
      defaultTextProperty('chunkId', 'Chunk identifier within the paper.'),
      defaultTextProperty('text', 'Full chunk text content.'),
      defaultTextProperty(
        'section',
        'Section or heading the chunk belongs to.',
      ),
      {
        name: 'pageNumber',
        description: 'Page number where the chunk originates.',
        dataType: ['int'],
      },
      {
        name: 'tokenStart',
        description: 'Token start index of the chunk within the paper.',
        dataType: ['int'],
      },
      {
        name: 'tokenEnd',
        description: 'Token end index of the chunk within the paper.',
        dataType: ['int'],
      },
      defaultTextProperty(
        'citations',
        'Inline citation identifiers referenced in this chunk.',
        { dataType: ['text[]'] },
      ),
      {
        name: 'figureIds',
        description: 'Figure identifiers referenced by this chunk.',
        dataType: ['text[]'],
      },
    ],
  },
  {
    class: 'Figure',
    description: 'Figure or table associated with a paper, including caption.',
    vectorizer: TEXT_MODULE,
    moduleConfig: {
      [TEXT_MODULE]: {
        vectorizeClassName: false,
      },
    },
    vectorIndexConfig: {
      distance: 'cosine',
    },
    invertedIndexConfig: {
      bm25: {
        k1: 1.2,
        b: 0.75,
      },
    },
    properties: [
      defaultTextProperty('paperId', 'Unique identifier for the paper.'),
      defaultTextProperty('figureId', 'Figure identifier within the paper.'),
      defaultTextProperty(
        'caption',
        'Text caption describing the figure or table.',
      ),
      {
        name: 'pageNumber',
        description: 'Page number the figure appears on.',
        dataType: ['int'],
      },
      defaultTextProperty(
        'imageUrl',
        'Canonical URL for the rendered figure image.',
      ),
      {
        name: 'chunks',
        description: 'Chunks referencing this figure.',
        dataType: ['PaperChunk'],
      },
    ],
  },
  {
    class: 'Citation',
    description: 'Bibliographic citation extracted from the paper.',
    vectorizer: TEXT_MODULE,
    moduleConfig: {
      [TEXT_MODULE]: {
        vectorizeClassName: false,
      },
    },
    vectorIndexConfig: {
      distance: 'cosine',
    },
    invertedIndexConfig: {
      bm25: {
        k1: 1.2,
        b: 0.75,
      },
    },
    properties: [
      defaultTextProperty('paperId', 'Unique identifier for the paper.'),
      defaultTextProperty(
        'citationId',
        'Identifier for the citation inside the paper.',
      ),
      defaultTextProperty('title', 'Title of the cited work.'),
      defaultTextProperty(
        'authors',
        'Authors credited in the citation.',
        { dataType: ['text[]'] },
      ),
      {
        name: 'year',
        description: 'Publication year for the cited work.',
        dataType: ['int'],
      },
      defaultTextProperty('source', 'Source venue or publication.'),
      defaultTextProperty('doi', 'Digital Object Identifier.'),
      defaultTextProperty('url', 'Canonical URL for the cited work.'),
      {
        name: 'chunks',
        description: 'Chunks referencing this citation.',
        dataType: ['PaperChunk'],
      },
    ],
  },
  {
    class: 'PersonaConcept',
    description:
      'Concepts that represent what the current user already knows or learned.',
    vectorizer: TEXT_MODULE,
    moduleConfig: {
      [TEXT_MODULE]: {
        vectorizeClassName: false,
      },
    },
    vectorIndexConfig: {
      distance: 'cosine',
    },
    invertedIndexConfig: {
      bm25: {
        k1: 1.2,
        b: 0.75,
      },
    },
    properties: [
      defaultTextProperty('userId', 'User identifier the concept belongs to.'),
      defaultTextProperty('concept', 'Name of the concept.'),
      defaultTextProperty(
        'description',
        'Short description or notes about the concept.',
      ),
      defaultTextProperty(
        'firstSeenPaperId',
        'Paper identifier where the concept first appeared.',
      ),
      {
        name: 'learnedAt',
        description: 'Timestamp when the concept was marked as learned.',
        dataType: ['date'],
      },
      {
        name: 'confidence',
        description: 'Confidence (0-1) for how well the user knows the concept.',
        dataType: ['number'],
      },
    ],
  },
  {
    class: 'Interaction',
    description:
      'User interactions (questions, follow-ups) tied to a paper and persona state.',
    vectorizer: TEXT_MODULE,
    moduleConfig: {
      [TEXT_MODULE]: {
        vectorizeClassName: false,
      },
    },
    vectorIndexConfig: {
      distance: 'cosine',
    },
    invertedIndexConfig: {
      bm25: {
        k1: 1.2,
        b: 0.75,
      },
    },
    properties: [
      defaultTextProperty('userId', 'User identifier for the interaction.'),
      defaultTextProperty('paperId', 'Paper identifier for the interaction.'),
      defaultTextProperty(
        'interactionType',
        'Type of interaction (question, feedback, prereq-check, etc).',
      ),
      defaultTextProperty(
        'prompt',
        'Raw prompt or user input for the interaction.',
      ),
      defaultTextProperty(
        'response',
        'Model response associated with the interaction.',
      ),
      {
        name: 'createdAt',
        description: 'Timestamp when the interaction occurred.',
        dataType: ['date'],
      },
      {
        name: 'chunks',
        description:
          'Chunks used to answer or ground the interaction response.',
        dataType: ['PaperChunk'],
      },
      {
        name: 'personaConcepts',
        description: 'Persona concepts referenced during the interaction.',
        dataType: ['PersonaConcept'],
      },
    ],
  },
];

export async function ensureWeaviateSchema(
  providedClient?: WeaviateClient,
): Promise<void> {
  const client = providedClient ?? getWeaviateClient();

  await verifyWeaviateConnection(client);

  for (const schemaClass of classes) {
    if (!schemaClass.class) {
      continue;
    }

    const exists = await client.schema.exists(schemaClass.class);

    if (!exists) {
      await client.schema.classCreator().withClass(schemaClass).do();
    }
  }
}

export function getWeaviateClasses(): readonly WeaviateClass[] {
  return classes;
}
