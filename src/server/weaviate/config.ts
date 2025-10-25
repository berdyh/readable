export interface WeaviateEnvironmentConfig {
  scheme: string;
  host: string;
  apiKey?: string;
  openAiApiKey?: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function normalizeUrl(maybeUrl: string): string {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(maybeUrl)) {
    return maybeUrl;
  }

  return `https://${maybeUrl}`;
}

export function getWeaviateEnvironment(): WeaviateEnvironmentConfig {
  const url = process.env.WEAVIATE_URL;

  if (!url) {
    throw new Error(
      'WEAVIATE_URL is required to initialize the Weaviate client. Set it in your environment (.env.local).',
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(normalizeUrl(url));
  } catch (error) {
    console.error(
      `[weaviate] Invalid WEAVIATE_URL provided: "${url}". Expected full URL or host (e.g. "https://cluster.weaviate.cloud").`,
    );
    throw error;
  }

  return {
    scheme: parsed.protocol.replace(':', ''),
    host: parsed.host,
    apiKey: process.env.WEAVIATE_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
    timeoutMs: Number(process.env.WEAVIATE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}
