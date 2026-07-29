/**
 * LLM Provider Abstraction Layer
 *
 * This module provides a unified interface for interacting with different LLM providers
 * (OpenAI, Anthropic, Gemini, OpenRouter, local coding agents). It abstracts away provider-specific implementations
 * and provides a consistent API for generating JSON and text responses.
 *
 * Usage:
 * ```typescript
 * import { generateJson, generateText } from '@/server/llm';
 *
 * // Generate structured JSON response
 * const result = await generateJson({
 *   systemPrompt: 'You are a helpful assistant.',
 *   userPrompt: 'Summarize this paper.',
 *   schema: { type: 'object', properties: { ... } },
 * }, { taskName: 'summary' });
 *
 * // Generate plain text response
 * const text = await generateText({
 *   systemPrompt: 'You are a helpful assistant.',
 *   userPrompt: 'Explain this concept.',
 * });
 * ```
 */

export type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmProviderInterface,
  LlmConfig,
} from "./types";

export {
  createLlmProvider,
  getDefaultProvider,
  generateJson,
  generateText,
  isLocalCodingAgentActive,
} from "./router";

export { OpenAiProvider } from "./providers/openai";
export { AnthropicProvider } from "./providers/anthropic";
export { GeminiProvider } from "./providers/gemini";
export { OpenRouterProvider } from "./providers/openrouter";
export {
  LocalCodingAgentProvider,
  describeLocalCodingAgents,
  isLocalAgentRuntime,
  listAvailableLocalCodingAgents,
  parseLocalAgentPin,
  type CodingAgentId,
  type LocalAgentUnavailableReason,
  type LocalCodingAgentStatus,
} from "./providers/local-coding-agent";
