import type {
  LlmProvider,
  LlmProviderInterface,
  LlmRequest,
  LlmConfig,
} from '../types';
import { getModel } from '@/server/llm-config/models';

const DEFAULT_TIMEOUT_MS = 60_000;

interface GeminiProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
}

function requireEnvVar(name: string, purpose: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} is required ${purpose}`);
  }
  return value.trim();
}

function getDefaultModel(taskType?: string): string {
  // Use model config from llm-config, with env var override support
  const modelFromConfig = getModel('gemini', taskType);
  
  // Check for legacy env vars or new override
  const envModel = process.env.GEMINI_MODEL || 
                   (taskType === 'summary' || taskType === 'summarize' 
                     ? process.env.GEMINI_SUMMARY_MODEL 
                     : undefined) ||
                   (taskType === 'qa' || taskType === 'question' 
                     ? process.env.GEMINI_QA_MODEL 
                     : undefined);
  
  return envModel || modelFromConfig;
}

function getGeminiConfig(config?: LlmConfig): GeminiProviderConfig {
  const apiKey =
    config?.apiKey ??
    requireEnvVar('GEMINI_API_KEY', 'to use Gemini. Set it in your environment.');
  const baseUrl =
    (config?.baseUrl as string) ??
    process.env.GEMINI_API_BASE_URL ??
    'https://generativelanguage.googleapis.com/v1beta';
  const model =
    (config?.model as string) ?? getDefaultModel();

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    timeoutMs:
      (config?.timeoutMs as number) ??
      Number(process.env.GEMINI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

export class GeminiProvider implements LlmProviderInterface {
  private config: GeminiProviderConfig;
  private taskType?: string;

  constructor(config?: LlmConfig, taskType?: string) {
    this.config = getGeminiConfig(config);
    this.taskType = taskType;
  }

  async generateJson(
    request: LlmRequest,
    options?: { taskName?: string },
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      // Gemini uses different endpoint structure
      const url = `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

      // Gemini requires JSON in system instruction for structured output
      const systemInstruction = `${request.systemPrompt}\n\nYou must respond with valid JSON only. Follow this schema: ${JSON.stringify(request.schema ?? {})}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: request.userPrompt,
                },
              ],
            },
          ],
          systemInstruction: {
            parts: [
              {
                text: systemInstruction,
              },
            ],
          },
          generationConfig: {
            temperature: request.temperature ?? 0.3,
            responseMimeType: 'application/json',
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response
          .text()
          .catch(() => 'Unable to read response body.');
        throw new Error(
          `Gemini request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const candidates = payload.candidates as Array<{
        content?: { parts?: Array<{ text?: string }> };
        finishReason?: string;
      }>;

      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error('Gemini response did not include candidates.');
      }

      const firstCandidate = candidates[0];
      const parts = firstCandidate.content?.parts;

      if (!Array.isArray(parts) || parts.length === 0) {
        throw new Error('Gemini response did not include content parts.');
      }

      const textContent = parts[0]?.text;

      if (typeof textContent !== 'string' || !textContent.trim()) {
        throw new Error('Gemini response did not include text content.');
      }

      // Extract JSON from response (may be wrapped in markdown code blocks)
      const trimmed = textContent.trim();
      const jsonMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
      return jsonMatch ? jsonMatch[1].trim() : trimmed;
    } finally {
      clearTimeout(timer);
    }
  }

  async generateText(request: LlmRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const url = `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${this.config.apiKey}`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `${request.systemPrompt}\n\n${request.userPrompt}`,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: request.temperature ?? 0.3,
          },
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response
          .text()
          .catch(() => 'Unable to read response body.');
        throw new Error(
          `Gemini request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const candidates = payload.candidates as Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;

      if (!Array.isArray(candidates) || candidates.length === 0) {
        throw new Error('Gemini response did not include candidates.');
      }

      const firstCandidate = candidates[0];
      const parts = firstCandidate.content?.parts;

      if (!Array.isArray(parts) || parts.length === 0) {
        throw new Error('Gemini response did not include content parts.');
      }

      const textContent = parts[0]?.text;

      if (typeof textContent !== 'string' || !textContent.trim()) {
        throw new Error('Gemini response did not include text content.');
      }

      return textContent.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  getProviderName(): LlmProvider {
    return 'gemini';
  }
}

