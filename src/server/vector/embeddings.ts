/**
 * Pluggable embeddings layer.
 *
 * The active embedder is chosen by the `EMBEDDING_PROVIDER` env var
 * (`auto` | `openai` | `openrouter` | `local`). Each provider exposes its native vector
 * dimension, and the resulting `collection` field is used by `qdrant.ts`
 * to keep one Qdrant collection per provider+model. Switching providers
 * therefore queries a different collection and never tries to mix vector
 * spaces.
 *
 * Add a new provider by extending `EmbeddingProviderId`, adding a config
 * resolver, and dispatching in `requestEmbeddings()`.
 */

export type EmbeddingProviderId = "openai" | "openrouter" | "local";

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

const OPENAI_DEFAULT_BASE_URL = "https://api.openai.com/v1";
const OPENAI_DEFAULT_MODEL = "text-embedding-3-small";
const OPENAI_DEFAULT_DIMENSIONS = 1536;

const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_DEFAULT_MODEL = "nvidia/llama-nemotron-embed-vl-1b-v2:free";
const OPENROUTER_DEFAULT_DIMENSIONS = 2048;
const OPENROUTER_DEFAULT_REFERER = "https://github.com/berdyh/readable";
const OPENROUTER_DEFAULT_TITLE = "Readable";

const LOCAL_DEFAULT_MODEL = "hash-v1";
const LOCAL_DEFAULT_DIMENSIONS = 384;

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.floor(value);
}

function slugifyForCollection(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function deriveCollectionName(providerId: string, model: string): string {
  return `paper_chunks_${slugifyForCollection(`${providerId}_${model}`)}`;
}

export function getActiveEmbeddingProvider(): EmbeddingProviderId {
  const raw = process.env.EMBEDDING_PROVIDER?.trim().toLowerCase();

  if (!raw || raw === "auto") {
    return readOptionalEnv("OPENROUTER_API_KEY") ? "openrouter" : "local";
  }

  if (raw === "local") {
    return raw;
  }

  if (raw === "openrouter") {
    if (readOptionalEnv("OPENROUTER_API_KEY")) {
      return "openrouter";
    }

    console.warn(
      '[embeddings] EMBEDDING_PROVIDER=openrouter but OPENROUTER_API_KEY is not set; falling back to "local".',
    );
    return "local";
  }

  if (raw === "openai") {
    if (readOptionalEnv("OPENAI_API_KEY")) {
      return "openai";
    }

    console.warn(
      '[embeddings] EMBEDDING_PROVIDER=openai but OPENAI_API_KEY is not set; falling back to "local".',
    );
    return "local";
  }

  console.warn(`[embeddings] Unknown EMBEDDING_PROVIDER "${raw}" — falling back to "local".`);
  return "local";
}

function getOpenAiEmbeddingEnvironment(): EmbeddingEnvironmentConfig {
  const apiKey = readOptionalEnv("OPENAI_API_KEY");
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required for the OpenAI embedder. Set it in .env.local or set EMBEDDING_PROVIDER=openrouter.",
    );
  }

  const model = process.env.EMBEDDING_MODEL ?? OPENAI_DEFAULT_MODEL;
  const dimensions = readPositiveIntegerEnv("EMBEDDING_DIMENSIONS", OPENAI_DEFAULT_DIMENSIONS);

  return {
    providerId: "openai",
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL ?? OPENAI_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model,
    dimensions,
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    collection: process.env.QDRANT_COLLECTION ?? deriveCollectionName("openai", model),
  };
}

function getOpenRouterEmbeddingEnvironment(): EmbeddingEnvironmentConfig {
  const apiKey = readOptionalEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is required for the OpenRouter embedder. Set it in .env.local or switch EMBEDDING_PROVIDER.",
    );
  }

  const model = process.env.OPENROUTER_EMBEDDING_MODEL ?? OPENROUTER_DEFAULT_MODEL;
  const dimensions = readPositiveIntegerEnv(
    "OPENROUTER_EMBEDDING_DIMENSIONS",
    OPENROUTER_DEFAULT_DIMENSIONS,
  );

  return {
    providerId: "openrouter",
    apiKey,
    baseUrl: (process.env.OPENROUTER_BASE_URL ?? OPENROUTER_DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model,
    dimensions,
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    collection: process.env.QDRANT_COLLECTION ?? deriveCollectionName("openrouter", model),
    extraHeaders: {
      "HTTP-Referer": process.env.OPENROUTER_HTTP_REFERER ?? OPENROUTER_DEFAULT_REFERER,
      "X-Title": process.env.OPENROUTER_X_TITLE ?? OPENROUTER_DEFAULT_TITLE,
    },
  };
}

function getLocalEmbeddingEnvironment(): EmbeddingEnvironmentConfig {
  const model = process.env.LOCAL_EMBEDDING_MODEL ?? LOCAL_DEFAULT_MODEL;
  const dimensions = readPositiveIntegerEnv("LOCAL_EMBEDDING_DIMENSIONS", LOCAL_DEFAULT_DIMENSIONS);

  return {
    providerId: "local",
    apiKey: "local",
    baseUrl: "local://embeddings",
    model,
    dimensions,
    timeoutMs: Number(process.env.EMBEDDING_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    collection: process.env.QDRANT_COLLECTION ?? deriveCollectionName("local", model),
  };
}

export function getEmbeddingEnvironment(
  override?: EmbeddingProviderId,
): EmbeddingEnvironmentConfig {
  const providerId = override ?? getActiveEmbeddingProvider();
  switch (providerId) {
    case "openai":
      return getOpenAiEmbeddingEnvironment();
    case "openrouter":
      return getOpenRouterEmbeddingEnvironment();
    case "local":
      return getLocalEmbeddingEnvironment();
    default: {
      const exhaustive: never = providerId;
      throw new Error(`Unsupported embedding provider: ${exhaustive}`);
    }
  }
}

interface EmbeddingResponse {
  data?: unknown;
  error?: { message?: string };
}

interface RequestEmbeddingsOptions {
  validateDimensions?: boolean;
}

function hashString(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function tokenizeForLocalEmbedding(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g);
  if (tokens?.length) {
    return tokens;
  }

  const fallback = text.trim();
  return fallback ? [fallback] : ["empty"];
}

function createLocalEmbedding(text: string, dimensions: number): number[] {
  const size =
    Number.isFinite(dimensions) && dimensions > 0
      ? Math.floor(dimensions)
      : LOCAL_DEFAULT_DIMENSIONS;
  const vector = Array.from({ length: size }, () => 0);
  const tokens = tokenizeForLocalEmbedding(text);

  for (const token of tokens) {
    const hash = hashString(token);
    const bucket = hash % size;
    const sign = hash & 1 ? 1 : -1;
    vector[bucket] += sign;
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }

  return vector.map((value) => value / norm);
}

function validateEmbeddingResponseData(
  data: unknown,
  expectedCount: number,
  env: EmbeddingEnvironmentConfig,
  options: RequestEmbeddingsOptions = {},
): number[][] {
  if (!Array.isArray(data) || data.length !== expectedCount) {
    throw new Error(
      `${env.providerId} embeddings response mismatch: requested ${expectedCount}, received ${Array.isArray(data) ? data.length : 0}.`,
    );
  }

  const validateDimensions = options.validateDimensions ?? true;
  const vectors: Array<number[] | undefined> = new Array(expectedCount);

  for (const rawItem of data) {
    if (!rawItem || typeof rawItem !== "object") {
      throw new Error(`${env.providerId} embeddings response item was malformed.`);
    }

    const item = rawItem as Record<string, unknown>;
    const index = item.index;
    if (
      !Number.isInteger(index) ||
      typeof index !== "number" ||
      index < 0 ||
      index >= expectedCount
    ) {
      throw new Error(`${env.providerId} embeddings response contained an invalid index.`);
    }

    if (vectors[index]) {
      throw new Error(`${env.providerId} embeddings response contained duplicate index ${index}.`);
    }

    const embedding = item.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error(`${env.providerId} embeddings response item ${index} was missing a vector.`);
    }

    if (validateDimensions && embedding.length !== env.dimensions) {
      throw new Error(
        `${env.providerId} embeddings response item ${index} had dimension ${embedding.length}; expected ${env.dimensions}.`,
      );
    }

    const vector = embedding.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(
          `${env.providerId} embeddings response item ${index} contained a non-finite vector value.`,
        );
      }
      return value;
    });

    vectors[index] = vector;
  }

  const missingIndex = vectors.findIndex((value) => !value);
  if (missingIndex >= 0) {
    throw new Error(`${env.providerId} embeddings response was missing index ${missingIndex}.`);
  }

  return vectors as number[][];
}

async function requestEmbeddings(
  texts: string[],
  env: EmbeddingEnvironmentConfig,
  options: RequestEmbeddingsOptions = {},
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  if (env.providerId === "local") {
    return texts.map((text) => createLocalEmbedding(text, env.dimensions));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.apiKey}`,
      ...(env.extraHeaders ?? {}),
    };

    const body: Record<string, unknown> = {
      model: env.model,
      input: texts,
    };

    // OpenAI accepts `dimensions` for Matryoshka-capable models. OpenRouter
    // embedding models are kept at their configured native dimension unless
    // a specific model documents otherwise.
    if (env.providerId === "openai") {
      body.dimensions = env.dimensions;
    }

    const response = await fetch(`${env.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${env.providerId} embeddings request failed (${response.status}): ${text}`);
    }

    const payload = (await response.json()) as EmbeddingResponse;

    if (payload.error) {
      throw new Error(`${env.providerId} embeddings error: ${payload.error.message ?? "unknown"}`);
    }

    return validateEmbeddingResponseData(payload.data, texts.length, env, options);
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
    const sanitized = batch.map((text) => (text?.trim() ? text : "​"));
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
  const [vector] = await requestEmbeddings([options.sample ?? "hello"], env, {
    validateDimensions: false,
  });
  return {
    providerId: env.providerId,
    model: env.model,
    dimensions: vector?.length ?? 0,
  };
}
