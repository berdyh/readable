/**
 * Common types and interfaces for LLM providers
 */

export type LlmProvider = 'openai' | 'anthropic' | 'gemini';

export interface LlmRequest {
  systemPrompt: string;
  userPrompt: string;
  schema?: Record<string, unknown>;
  temperature?: number;
}

export interface LlmResponse {
  content: string;
  finishReason?: string;
}

export interface LlmProviderInterface {
  /**
   * Generate a response with structured JSON output
   */
  generateJson(
    request: LlmRequest,
    options?: { taskName?: string },
  ): Promise<string>;

  /**
   * Generate a plain text response
   */
  generateText(request: LlmRequest): Promise<string>;

  /**
   * Get the provider name
   */
  getProviderName(): LlmProvider;
}

export interface LlmConfig {
  provider: LlmProvider;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  [key: string]: unknown; // Allow provider-specific config
}

