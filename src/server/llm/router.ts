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
 * Get the default LLM provider from environment variables. OpenRouter
 * is the default because it has a no-cost free tier (Llama 3.3 70B,
 * DeepSeek v3.1, Qwen3 235B) and an OpenAI-compatible API, so a
 * brand-new install with just OPENROUTER_API_KEY set works without
 * additional configuration.
 */
export function getDefaultProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'openrouter').toLowerCase() as LlmProvider;

  if (!SUPPORTED_PROVIDERS.includes(provider)) {
    console.warn(`[llm] Invalid LLM_PROVIDER "${provider}", falling back to "openrouter"`);
    return 'openrouter';
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
 * Warn once when the user has authenticated multiple providers but
 * hasn't opted into the fallback chain. Easy onboarding miss — the
 * routing layer is silent until LLM_ALLOWED_PROVIDERS is set.
 */
let routingHintLogged = false;
function maybeLogRoutingHint(): void {
  if (routingHintLogged) return;
  routingHintLogged = true;
  if (process.env.LLM_ALLOWED_PROVIDERS?.trim()) return;
  const configured = SUPPORTED_PROVIDERS.filter((provider) =>
    hasAnyProviderKey(provider),
  );
  if (configured.length >= 2) {
    console.info(
      `[llm] You have keys for ${configured.join(', ')} but LLM_ALLOWED_PROVIDERS is unset. ` +
        'Set it (e.g. `LLM_ALLOWED_PROVIDERS=' +
        configured.join(',') +
        '`) to enable OpenClaw-style fallback. Run `pnpm setup` for an interactive picker.',
    );
  }
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
 * Re-build the auth-profile store on every call so cooldown state — which
 * lives in `usageStats` and is persisted via `persistUsageWrites: true`
 * inside the loop — is always loaded fresh from disk. CLI auth files are
 * mtime-cached internally so the rebuild is cheap (one or two JSON reads
 * per request).
 *
 * We deliberately do NOT keep the store as a module-level singleton:
 * multiple parallel requests need to see each other's most-recent
 * cooldowns, and a cached promise in module scope would isolate them.
 */
async function getAuthProfileStore(): Promise<AuthProfileStore> {
  return buildAuthProfileStore({ agentId: 'default' });
}

/**
 * Kept as an exported no-op so existing call sites (setup CLI, tests)
 * that asked the router to forget cached state continue to compile. The
 * cache no longer exists; this is now equivalent to "do nothing".
 */
export function resetAuthProfileStoreCache(): void {
  // Intentionally empty — see getAuthProfileStore comment.
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
      // Persist after every cooldown / success so the next request (and
      // the next process) sees the up-to-date state. Without this,
      // FallbackSummaryError loses the cooldowns it accumulated and
      // identical traffic re-fires the same failed providers.
      persistUsageWrites: true,
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
    maybeLogRoutingHint();
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
    maybeLogRoutingHint();
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
