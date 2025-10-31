import type { LlmProvider, LlmProviderInterface, LlmConfig } from './types';
import { OpenAiProvider } from './providers/openai';
import { AnthropicProvider } from './providers/anthropic';
import { GeminiProvider } from './providers/gemini';

/**
 * Get the default LLM provider from environment variables
 */
export function getDefaultProvider(): LlmProvider {
  const provider = (process.env.LLM_PROVIDER ?? 'openai').toLowerCase() as LlmProvider;
  
  // Validate provider
  if (!['openai', 'anthropic', 'gemini'].includes(provider)) {
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
    default:
      throw new Error(`Unsupported LLM provider: ${provider}`);
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
  const config: LlmConfig = {
    provider: options?.provider ?? getDefaultProvider(),
    ...options?.config,
  };

  // Override temperature if provided in options
  const finalRequest = {
    ...request,
    temperature: options?.temperature ?? request.temperature,
  };

  const llm = createLlmProvider(config, options?.taskName);
  return llm.generateJson(finalRequest, { taskName: options?.taskName });
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
  const config: LlmConfig = {
    provider: options?.provider ?? getDefaultProvider(),
    ...options?.config,
  };

  const llm = createLlmProvider(config, options?.taskName);
  return llm.generateText(request);
}

