import weaviate, {
  ApiKey,
  type ConnectionParams,
  type WeaviateClient,
} from 'weaviate-ts-client';

import type { WeaviateEnvironmentConfig } from './config';
import { getWeaviateEnvironment } from './config';

export interface CreateWeaviateClientOptions {
  environment?: Partial<WeaviateEnvironmentConfig>;
}

function buildConnectionParams(
  options?: CreateWeaviateClientOptions,
): ConnectionParams {
  const env = { ...getWeaviateEnvironment(), ...(options?.environment ?? {}) };
  const headers: HeadersInit = {};

  if (env.openAiApiKey) {
    headers['X-OpenAI-Api-Key'] = env.openAiApiKey;
  }

  return {
    scheme: env.scheme,
    host: env.host,
    apiKey: env.apiKey ? new ApiKey(env.apiKey) : undefined,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  };
}

export function createWeaviateClient(
  options?: CreateWeaviateClientOptions,
): WeaviateClient {
  return weaviate.client(buildConnectionParams(options));
}

let clientSingleton: WeaviateClient | undefined;

declare global {
  var __weaviateClient: WeaviateClient | undefined;
}

export function getWeaviateClient(): WeaviateClient {
  if (clientSingleton) {
    return clientSingleton;
  }

  if (typeof globalThis !== 'undefined' && globalThis.__weaviateClient) {
    clientSingleton = globalThis.__weaviateClient;
    return clientSingleton;
  }

  const client = createWeaviateClient();

  if (typeof globalThis !== 'undefined') {
    globalThis.__weaviateClient = client;
  }

  clientSingleton = client;
  return clientSingleton;
}

export async function verifyWeaviateConnection(
  client: WeaviateClient = getWeaviateClient(),
): Promise<void> {
  let env: WeaviateEnvironmentConfig;

  try {
    env = getWeaviateEnvironment();
  } catch (error) {
    console.error(
      '[weaviate] Missing or invalid configuration for WEAVIATE_URL.',
    );
    throw error;
  }

  let liveResponse: { status?: string } | undefined;
  let readyResponse: { status?: string } | undefined;

  try {
    [liveResponse, readyResponse] = await Promise.all([
      client.misc.liveChecker().do(),
      client.misc.readyChecker().do(),
    ]);
  } catch (error) {
    console.error(
      `[weaviate] Failed to reach ${env.scheme}://${env.host} (timeout ${
        env.timeoutMs
      }ms).`,
    );
    if (error instanceof Error) {
      console.error(`[weaviate] ${error.message}`);
    } else {
      console.error('[weaviate] Unexpected error object:', error);
    }
    throw error;
  }

  const liveStatus = liveResponse?.status ?? 'UNKNOWN';
  const readyStatus = readyResponse?.status ?? 'UNKNOWN';

  if (liveStatus !== 'LIVE' || readyStatus !== 'READY') {
    const message = `[weaviate] Health check failed for ${env.scheme}://${env.host} (timeout ${env.timeoutMs}ms). Live=${liveStatus} Ready=${readyStatus}`;
    console.error(message);
    throw new Error(message);
  }
}
