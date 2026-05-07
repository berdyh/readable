import type { LlmProvider, LlmProviderInterface, LlmConfig } from './types';
import { OpenAiProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';
import { OpenRouterProvider } from './providers/openrouter';
import { getModel } from '@/server/llm-config/models';
import {
  buildAuthProfileStore,
  FailoverError,
  hasAnyProviderKey,
  runWithModelFallback,
  saveUsageStatsOnly,
  type AuthProfileStore,
  type ModelRef,
  type RoutingProviderId,
  type RunFn,
} from './routing';

const SUPPORTED_PROVIDERS: LlmProvider[] = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
];

/**
 * Get the default LLM provider from environment variables
 */
export function getDefaultProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase() as LlmProvider;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    console.warn(`[llm] Invalid LLM_PROVIDER "${provider}", falling back to "openai"`);
    return 'openai';
  }

  return provider;
}

/**
 * Create an LLM provider instance based on configuration
 */
export function createLlmProvider(
  config?: LlmConfig,
  taskType?: string,
): LlmProviderInterface {
  const provider = config?.provider ?? getDefaultProvider();

  switch (provider) {
    case 'openai':
      return new OpenAiProvider(config, taskType);
    case 'anthropic':
      return new AnthropicProvider(config, taskType);
    case 'gemini':
      return new GeminiProvider(config, taskType);
    case 'openrouter':
      return new OpenRouterProvider(config, taskType);
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
  }
}

/**
 * Map a RoutingProviderId (which encodes runtime variants like
 * `openai-codex`) onto the LlmProvider that owns the SDK class. Returns
 * undefined if no provider class can serve this routing variant — those
 * candidates are silently skipped by the fallback loop.
 */
function routingProviderToLlmProvider(
  provider: RoutingProviderId,
): LlmProvider | undefined {
  switch (provider) {
    case 'openai':
    case 'anthropic':
    case 'gemini':
    case 'openrouter':
      return provider;
    case 'openai-codex':
      // Codex OAuth tokens hit OpenAI's chat completions endpoint, but
      // require a different base URL + headers. We don't yet ship a
      // dedicated provider class for that, so skip.
      return undefined;
    case 'google-vertex':
      return undefined;
    default:
      return undefined;
  }
}

function parseAllowedProviders(): LlmProvider[] {
  const raw = process.env.LLM_ALLOWED_PROVIDERS?.trim();
  if (!raw) return [];
  return raw
    .split(/[\s,;]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is LlmProvider =>
      (SUPPORTED_PROVIDERS as string[]).includes(entry),
    );
}

/**
 * Build the candidate ModelRef chain for a request.
 *
 * Primary candidate = explicit options.provider OR LLM_PROVIDER env.
 * Fallbacks = LLM_ALLOWED_PROVIDERS env (comma-separated), with the
 * primary deduplicated and any provider lacking an env key dropped (so
 * we don't waste a turn on a provider we can't authenticate).
 */
function buildCandidates(
  primaryProvider: LlmProvider,
  taskType: string | undefined,
): { primary: ModelRef; fallbacks: ModelRef[] } {
  const primaryModel = getModel(primaryProvider, taskType);
  const primary = `${primaryProvider}/${primaryModel}` as ModelRef;

  const allowed = parseAllowedProviders();
  if (allowed.length === 0) {
    return { primary, fallbacks: [] };
  }

  const seen = new Set<string>([primary]);
  const fallbacks: ModelRef[] = [];
  for (const provider of allowed) {
    if (provider === primaryProvider) continue;
    if (!hasAnyProviderKey(provider)) continue;
    const modelName = getModel(provider, taskType);
    const ref = `${provider}/${modelName}` as ModelRef;
    if (seen.has(ref)) continue;
    seen.add(ref);
    fallbacks.push(ref);
  }
  return { primary, fallbacks };
}

/**
 * Cached AuthProfileStore — built once per Node process, reused across
 * requests. CLI auth files are mtime-checked on every detection call so
 * a token rotation gets picked up automatically; env keys are static for
 * the process lifetime so we don't pay for re-collection on every call.
 */
let cachedStorePromise: Promise<AuthProfileStore> | undefined;

async function getAuthProfileStore(): Promise<AuthProfileStore> {
  if (!cachedStorePromise) {
    cachedStorePromise = buildAuthProfileStore({ agentId: 'default' });
  }
  return cachedStorePromise;
}

/** For tests + setup-CLI flows that change env mid-process. */
export function resetAuthProfileStoreCache(): void {
  cachedStorePromise = undefined;
}

interface RouteRequestOptions {
  primaryProvider: LlmProvider;
  taskType?: string;
  baseConfig?: LlmConfig;
}

async function routeRequest<T>(
  invoke: (provider: LlmProviderInterface) => Promise<T>,
  options: RouteRequestOptions,
): Promise<T> {
  const { primary, fallbacks } = buildCandidates(
    options.primaryProvider,
    options.taskType,
  );
  const store = await getAuthProfileStore();

  const run: RunFn<T> = async (ctx) => {
    const llmProviderId = routingProviderToLlmProvider(ctx.provider);
    if (!llmProviderId) {
      throw new FailoverError(
        `Routing provider "${ctx.provider}" has no SDK adapter; skipping.`,
        {
          reason: 'model_not_found',
          provider: ctx.provider,
          model: ctx.model,
        },
      );
    }
    const config: LlmConfig = {
      ...options.baseConfig,
      provider: llmProviderId,
      apiKey: ctx.profile.secret,
      model: ctx.model,
    };
    const llm = createLlmProvider(config, options.taskType);
    return invoke(llm);
  };

  try {
    const result = await runWithModelFallback({
      primary,
      fallbacks,
      store,
      run,
    });
    // Persist usage stats best-effort. Don't await — we don't want to
    // block the response on disk I/O.
    saveUsageStatsOnly(result.store.usageStats ?? {}, 'default').catch(() => {
      /* ignore — next request will overwrite */
    });
    return result.result;
  } catch (error) {
    if (error instanceof FailoverError) {
      // Re-wrap so callers see something familiar in logs.
      throw new Error(
        `[llm] ${error.provider}/${error.model} failed (${error.reason}): ${error.message}`,
      );
    }
    throw error;
  }
}

/**
 * Convenience function for generating JSON responses
 */
export async function generateJson(
  request: {
    systemPrompt: string;
    userPrompt: string;
    schema: Record<string, unknown>;
    temperature?: number;
  },
  options?: {
    provider?: LlmProvider;
    taskName?: string;
    temperature?: number;
    config?: LlmConfig;
  },
): Promise<string> {
  const finalRequest = {
    ...request,
    temperature: options?.temperature ?? request.temperature,
  };

  const primaryProvider = options?.provider ?? getDefaultProvider();
  const allowed = parseAllowedProviders();

  // Legacy fast path: no LLM_ALLOWED_PROVIDERS env set, no fallback
  // requested. Skip the routing layer entirely so existing tests + the
  // single-provider deploy stay on the simpler code path.
  if (allowed.length === 0) {
    const config: LlmConfig = {
      provider: primaryProvider,
      ...options?.config,
    };
    const llm = createLlmProvider(config, options?.taskName);
    return llm.generateJson(finalRequest, { taskName: options?.taskName });
  }

  return routeRequest(
    (llm) => llm.generateJson(finalRequest, { taskName: options?.taskName }),
    {
      primaryProvider,
      taskType: options?.taskName,
      baseConfig: options?.config,
    },
  );
}

/**
 * Convenience function for generating text responses
 */
export async function generateText(
  request: {
    systemPrompt: string;
    userPrompt: string;
    temperature?: number;
  },
  options?: {
    provider?: LlmProvider;
    taskName?: string;
    config?: LlmConfig;
  },
): Promise<string> {
  const primaryProvider = options?.provider ?? getDefaultProvider();
  const allowed = parseAllowedProviders();

  if (allowed.length === 0) {
    const config: LlmConfig = {
      provider: primaryProvider,
      ...options?.config,
    };
    const llm = createLlmProvider(config, options?.taskName);
    return llm.generateText(request);
  }

  return routeRequest((llm) => llm.generateText(request), {
    primaryProvider,
    taskType: options?.taskName,
    baseConfig: options?.config,
  });
}
