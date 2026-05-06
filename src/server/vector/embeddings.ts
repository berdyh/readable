/**
 * Pluggable embeddings layer.
 *
 * The active embedder is chosen by the `EMBEDDING_PROVIDER` env var
 * (`openai` | `openrouter`). Each provider exposes its native vector
 * dimension, and the resulting `collection` field is used by `qdrant.ts`
 * to keep one Qdrant collection per provider+model. Switching providers
 * therefore queries a different collection and never tries to mix vector
 * spaces.
 *
 * Add a new provider by extending `EmbeddingProviderId`, adding a config
 * resolver, and dispatching in `requestEmbeddings()`.
 */

export type EmbeddingProviderId = 'openai' | 'openrouter';

export interface EmbeddingEnvironmentConfig {
  providerId: EmbeddingProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
  /** Qdrant collection name derived from provider + model. */
  collection: string;
  /**
   * Optional extra HTTP headers (OpenRouter requires `HTTP-Referer` /
   * `X-Title` for attribution).
   */
  extraHeaders?: Record<string, string>;
}

const DEFAULT_BATCH_SIZE = 64;
const DEFAULT_TIMEOUT_MS = 30_000;

const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const OPENAI_DEFAULT_MODEL = 'text-embedding-3-small';
const OPENAI_DEFAULT_DIMENSIONS = 1536;

const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_DEFAULT_MODEL = 'nvidia/llama-nemotron-embed-vl-1b-v2:free';
const OPENROUTER_DEFAULT_DIMENSIONS = 2048;
const OPENROUTER_DEFAULT_REFERER = 'https://github.com/berdyh/readable';
const OPENROUTER_DEFAULT_TITLE = 'Readable';

function slugifyForCollection(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function deriveCollectionName(providerId: string, model: string): string {
  return `paper_chunks_${slugifyForCollection(`${providerId}_${model}`)}`;
}

export function getActiveEmbeddingProvider(): EmbeddingProviderId {
  const raw = (process.env.EMBEDDING_PROVIDER ?? 'openai').trim().toLowerCase();
  if (raw === 'openai' || raw === 'openrouter') {
    return raw;
  }
  console.warn(
    `[embeddings] Unknown EMBEDDING_PROVIDER "${raw}" — falling back to "openai".`,
  );
  return 'openai';
}

function getOpenAiEmbeddingEnvironment(): EmbeddingEnvironmentConfig {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required for the OpenAI embedder. Set it in .env.local or set EMBEDDING_PROVIDER=openrouter.',
    );
  }

  const model = process.env.EMBEDDING_MODEL ?? OPENAI_DEFAULT_MODEL;
  const dimensions = Number(
    process.env.EMBEDDING_DIMENSIONS ?? OPENAI_DEFAULT_DIMENSIONS,
  );

  return {
    providerId: 'openai',
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL ?? OPENAI_DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    model,
    dimensions,
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    collection:
      process.env.QDRANT_COLLECTION ?? deriveCollectionName('openai', model),
  };
}

function getOpenRouterEmbeddingEnvironment(): EmbeddingEnvironmentConfig {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is required for the OpenRouter embedder. Set it in .env.local or switch EMBEDDING_PROVIDER.',
    );
  }

  const model =
    process.env.OPENROUTER_EMBEDDING_MODEL ?? OPENROUTER_DEFAULT_MODEL;
  const dimensions = Number(
    process.env.OPENROUTER_EMBEDDING_DIMENSIONS ?? OPENROUTER_DEFAULT_DIMENSIONS,
  );

  return {
    providerId: 'openrouter',
    apiKey,
    baseUrl: (
      process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL
    ).replace(/\/+$/, ''),
    model,
    dimensions,
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    collection:
      process.env.QDRANT_COLLECTION ??
      deriveCollectionName('openrouter', model),
    extraHeaders: {
      'HTTP-Referer':
        process.env.OPENROUTER_HTTP_REFERER ?? OPENROUTER_DEFAULT_REFERER,
      'X-Title': process.env.OPENROUTER_X_TITLE ?? OPENROUTER_DEFAULT_TITLE,
    },
  };
}

export function getEmbeddingEnvironment(
  override?: EmbeddingProviderId,
): EmbeddingEnvironmentConfig {
  const providerId = override ?? getActiveEmbeddingProvider();
  switch (providerId) {
    case 'openai':
      return getOpenAiEmbeddingEnvironment();
    case 'openrouter':
      return getOpenRouterEmbeddingEnvironment();
    default: {
      const exhaustive: never = providerId;
      throw new Error(`Unsupported embedding provider: ${exhaustive}`);
    }
  }
}

interface EmbeddingResponseItem {
  embedding: number[];
  index: number;
}

interface EmbeddingResponse {
  data?: EmbeddingResponseItem[];
  error?: { message?: string };
}

async function requestEmbeddings(
  texts: string[],
  env: EmbeddingEnvironmentConfig,
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.timeoutMs);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.apiKey}`,
      ...(env.extraHeaders ?? {}),
    };

    const body: Record<string, unknown> = {
      model: env.model,
      input: texts,
    };

    // Both OpenAI and OpenRouter accept `dimensions` for Matryoshka-capable
    // models. Setting it is harmless when unsupported (the provider returns
    // its native dim and the collection is sized accordingly via the
    // `collection` field).
    if (env.providerId === 'openai') {
      body.dimensions = env.dimensions;
    }

    const response = await fetch(`${env.baseUrl}/embeddings`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `${env.providerId} embeddings request failed (${response.status}): ${text}`,
      );
    }

    const payload = (await response.json()) as EmbeddingResponse;

    if (payload.error) {
      throw new Error(
        `${env.providerId} embeddings error: ${payload.error.message ?? 'unknown'}`,
      );
    }

    if (!payload.data || payload.data.length !== texts.length) {
      throw new Error(
        `${env.providerId} embeddings response mismatch: requested ${texts.length}, received ${payload.data?.length ?? 0}.`,
      );
    }

    const ordered = [...payload.data].sort((a, b) => a.index - b.index);
    return ordered.map((item) => item.embedding);
  } finally {
    clearTimeout(timer);
  }
}

export async function embedTexts(
  texts: string[],
  options: { batchSize?: number; environment?: EmbeddingEnvironmentConfig } = {},
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const env = options.environment ?? getEmbeddingEnvironment();
  const batchSize = Math.max(1, options.batchSize ?? DEFAULT_BATCH_SIZE);
  const results: number[][] = new Array(texts.length);

  for (let offset = 0; offset < texts.length; offset += batchSize) {
    const batch = texts.slice(offset, offset + batchSize);
    const sanitized = batch.map((text) => (text?.trim() ? text : '​'));
    const batchResult = await requestEmbeddings(sanitized, env);
    for (let i = 0; i < batchResult.length; i += 1) {
      results[offset + i] = batchResult[i];
    }
  }

  return results;
}

export async function embedQuery(
  text: string,
  options: { environment?: EmbeddingEnvironmentConfig } = {},
): Promise<number[]> {
  const [vector] = await embedTexts([text], options);
  return vector ?? [];
}

/**
 * Probe the active embedder for its native vector length. Useful for
 * picking the right value of `OPENROUTER_EMBEDDING_DIMENSIONS` when a model
 * ignores the requested `dimensions` parameter. Called from
 * `scripts/probe-embedding.ts`.
 */
export async function probeEmbeddingDimensions(
  options: { environment?: EmbeddingEnvironmentConfig; sample?: string } = {},
): Promise<{ providerId: EmbeddingProviderId; model: string; dimensions: number }> {
  const env = options.environment ?? getEmbeddingEnvironment();
  const [vector] = await requestEmbeddings([options.sample ?? 'hello'], env);
  return {
    providerId: env.providerId,
    model: env.model,
    dimensions: vector?.length ?? 0,
  };
}
