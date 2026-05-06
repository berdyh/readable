const DEFAULT_MODEL = 'text-embedding-3-small';
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_BATCH_SIZE = 64;

export interface EmbeddingEnvironmentConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  dimensions: number;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function getEmbeddingEnvironment(): EmbeddingEnvironmentConfig {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'OPENAI_API_KEY is required to generate embeddings. Set it in .env.local.',
    );
  }

  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL ?? DEFAULT_BASE_URL).replace(
      /\/+$/,
      '',
    ),
    model: process.env.EMBEDDING_MODEL ?? DEFAULT_MODEL,
    dimensions: Number(process.env.EMBEDDING_DIMENSIONS ?? DEFAULT_DIMENSIONS),
    timeoutMs: Number(
      process.env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS,
    ),
  };
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
    const response = await fetch(`${env.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.apiKey}`,
      },
      body: JSON.stringify({
        model: env.model,
        input: texts,
        dimensions: env.dimensions,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(
        `OpenAI embeddings request failed (${response.status}): ${text}`,
      );
    }

    const payload = (await response.json()) as EmbeddingResponse;

    if (payload.error) {
      throw new Error(
        `OpenAI embeddings error: ${payload.error.message ?? 'unknown'}`,
      );
    }

    if (!payload.data || payload.data.length !== texts.length) {
      throw new Error(
        `OpenAI embeddings response mismatch: requested ${texts.length}, received ${payload.data?.length ?? 0}.`,
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
