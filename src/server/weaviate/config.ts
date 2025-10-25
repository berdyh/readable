export interface WeaviateEnvironmentConfig {
  scheme: string;
  host: string;
  apiKey?: string;
  openAiApiKey?: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

export function getWeaviateEnvironment(): WeaviateEnvironmentConfig {
  const url = process.env.WEAVIATE_URL;

  if (!url) {
    throw new Error(
      'WEAVIATE_URL is required to initialize the Weaviate client. Set it in your environment (.env.local).',
    );
  }

  const parsed = new URL(url);

  return {
    scheme: parsed.protocol.replace(':', ''),
    host: parsed.host,
    apiKey: process.env.WEAVIATE_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY,
    timeoutMs: Number(process.env.WEAVIATE_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}
