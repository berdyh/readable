/**
 * Common types and interfaces for LLM providers
 */

export type LlmProvider = "openai" | "anthropic" | "gemini" | "openrouter" | "coding-agent";

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
  generateJson(request: LlmRequest, options?: { taskName?: string }): Promise<string>;

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
  /**
   * Pins `coding-agent` requests to one local CLI (`claude-code`, `codex-cli`).
   * Ignored by every hosted provider. Set from the chat window's agent picker.
   */
  localAgent?: string;
  [key: string]: unknown; // Allow provider-specific config
}
