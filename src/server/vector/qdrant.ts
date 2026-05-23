import { getEmbeddingEnvironment } from './embeddings';

export const PAPER_CHUNK_COLLECTION = 'paper_chunks';

export interface QdrantEnvironmentConfig {
  url: string;
  apiKey?: string;
  timeoutMs: number;
  collection: string;
  vectorSize: number;
  distance: 'Cosine' | 'Dot' | 'Euclid';
}

const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_VECTOR_SIZE = 1536;
const DEFAULT_COLLECTION = PAPER_CHUNK_COLLECTION;

/**
 * The Qdrant config is derived from the active embedding provider when
 * possible: each provider+model gets its own collection, sized to that
 * model's native dimension. Explicit `QDRANT_COLLECTION` /
 * `QDRANT_VECTOR_SIZE` env vars still win when set, which is useful for
 * single-provider deployments that want a stable collection name.
 */
export function getQdrantEnvironment(): QdrantEnvironmentConfig {
  const url = process.env.QDRANT_URL ?? 'http://localhost:6333';
  const apiKey = process.env.QDRANT_API_KEY;

  let collection = process.env.QDRANT_COLLECTION ?? DEFAULT_COLLECTION;
  let vectorSize = process.env.QDRANT_VECTOR_SIZE
    ? Number(process.env.QDRANT_VECTOR_SIZE)
    : DEFAULT_VECTOR_SIZE;

  if (!process.env.QDRANT_COLLECTION || !process.env.QDRANT_VECTOR_SIZE) {
    try {
      const embeddingEnv = getEmbeddingEnvironment();
      if (!process.env.QDRANT_COLLECTION) {
        collection = embeddingEnv.collection;
      }
      if (!process.env.QDRANT_VECTOR_SIZE) {
        vectorSize = embeddingEnv.dimensions;
      }
    } catch {
      // Embedding provider is not configured (e.g. no API key set yet).
      // Fall back to legacy defaults; ingest pipeline will still skip vector
      // indexing gracefully and the user's first paper-load surfaces the
      // missing-key error clearly.
    }
  }

  return {
    url: url.replace(/\/+$/, ''),
    apiKey,
    timeoutMs: Number(process.env.QDRANT_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    collection,
    vectorSize,
    distance:
      (process.env.QDRANT_DISTANCE as QdrantEnvironmentConfig['distance']) ??
      'Cosine',
  };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

async function qdrantRequest<T>(
  path: string,
  options: RequestOptions = {},
  env: QdrantEnvironmentConfig = getQdrantEnvironment(),
): Promise<T> {
  const url = new URL(`${env.url}${path}`);

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.timeoutMs);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (env.apiKey) {
    headers['api-key'] = env.apiKey;
  }

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `Qdrant request ${options.method ?? 'GET'} ${path} failed (${response.status}): ${text}`,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

interface CollectionInfoResult {
  result?: {
    config?: {
      params?: {
        vectors?: { size?: number; distance?: string };
      };
    };
  };
}

export async function ensureQdrantCollection(
  env: QdrantEnvironmentConfig = getQdrantEnvironment(),
): Promise<void> {
  try {
    const info = await qdrantRequest<CollectionInfoResult>(
      `/collections/${encodeURIComponent(env.collection)}`,
      { method: 'GET' },
      env,
    );

    const existing = info.result?.config?.params?.vectors;
    if (existing && existing.size && existing.size !== env.vectorSize) {
      throw new Error(
        `Qdrant collection "${env.collection}" already exists with size ${existing.size} but expected ${env.vectorSize}. Drop the collection or set QDRANT_VECTOR_SIZE to match.`,
      );
    }
    return;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !error.message.includes('failed (404)')
    ) {
      throw error;
    }
  }

  await qdrantRequest(
    `/collections/${encodeURIComponent(env.collection)}`,
    {
      method: 'PUT',
      body: {
        vectors: {
          size: env.vectorSize,
          distance: env.distance,
        },
      },
    },
    env,
  );

  await qdrantRequest(
    `/collections/${encodeURIComponent(env.collection)}/index`,
    {
      method: 'PUT',
      body: {
        field_name: 'paperId',
        field_schema: 'keyword',
      },
    },
    env,
  );

  await qdrantRequest(
    `/collections/${encodeURIComponent(env.collection)}/index`,
    {
      method: 'PUT',
      body: {
        field_name: 'pageNumber',
        field_schema: 'integer',
      },
    },
    env,
  );
}

export interface PaperChunkVectorPoint {
  id: string;
  vector: number[];
  payload: {
    paperId: string;
    chunkId: string;
    section?: string;
    pageNumber?: number;
    citations?: string[];
    figureIds?: string[];
  };
}

export async function upsertPaperChunkVectors(
  points: PaperChunkVectorPoint[],
  env: QdrantEnvironmentConfig = getQdrantEnvironment(),
): Promise<void> {
  if (points.length === 0) {
    return;
  }

  await qdrantRequest(
    `/collections/${encodeURIComponent(env.collection)}/points`,
    {
      method: 'PUT',
      body: {
        points: points.map((point) => ({
          id: point.id,
          vector: point.vector,
          payload: point.payload,
        })),
      },
      query: { wait: true },
    },
    env,
  );
}

export async function deletePaperChunkVectorsByPaper(
  paperId: string,
  env: QdrantEnvironmentConfig = getQdrantEnvironment(),
): Promise<void> {
  await qdrantRequest(
    `/collections/${encodeURIComponent(env.collection)}/points/delete`,
    {
      method: 'POST',
      body: {
        filter: {
          must: [
            {
              key: 'paperId',
              match: { value: paperId },
            },
          ],
        },
      },
      query: { wait: true },
    },
    env,
  );
}

export interface QdrantSearchHit {
  id: string;
  score: number;
  payload: PaperChunkVectorPoint['payload'];
  vector?: number[];
}

interface QdrantSearchResponse {
  result?: Array<{
    id: string | number;
    score: number;
    payload?: PaperChunkVectorPoint['payload'];
  }>;
}

export interface PaperChunkVectorSearchOptions {
  paperId: string;
  vector: number[];
  limit?: number;
  scoreThreshold?: number;
}

export async function searchPaperChunkVectors(
  options: PaperChunkVectorSearchOptions,
  env: QdrantEnvironmentConfig = getQdrantEnvironment(),
): Promise<QdrantSearchHit[]> {
  const response = await qdrantRequest<QdrantSearchResponse>(
    `/collections/${encodeURIComponent(env.collection)}/points/search`,
    {
      method: 'POST',
      body: {
        vector: options.vector,
        limit: options.limit ?? 10,
        with_payload: true,
        score_threshold: options.scoreThreshold,
        filter: {
          must: [
            {
              key: 'paperId',
              match: { value: options.paperId },
            },
          ],
        },
      },
    },
    env,
  );

  return (response.result ?? []).map((entry) => ({
    id: String(entry.id),
    score: entry.score,
    payload: (entry.payload ?? {
      paperId: options.paperId,
      chunkId: '',
    }) as PaperChunkVectorPoint['payload'],
  }));
}

export async function pingQdrant(
  env: QdrantEnvironmentConfig = getQdrantEnvironment(),
): Promise<void> {
  await qdrantRequest('/readyz', { method: 'GET' }, env);
}
