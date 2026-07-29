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

/**
 * Wire shape of `GET /api/llm/local-agents`.
 *
 * Lives here, not in the client, for the same reason the chat wire types do:
 * the server owns it and the client derives from it, so a change to the route
 * breaks the client at compile time rather than at runtime.
 */
export interface LocalAgentWireStatus {
  id: string;
  displayName: string;
  installed: boolean;
  authenticated: boolean;
  model: string;
  /** `null` when the agent is selectable. */
  unavailableReason: "not_installed" | "not_authenticated" | "not_enabled" | null;
  hint?: string;
}

export interface LocalAgentsResponse {
  /**
   * False when local agents cannot serve requests here — either the app is not
   * configured to use them, or it is deployed somewhere no CLI can run. The
   * agent list is empty in that case and the picker should stay hidden.
   */
  enabled: boolean;
  agents: LocalAgentWireStatus[];
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
