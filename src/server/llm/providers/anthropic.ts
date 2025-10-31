import type {
  LlmProvider,
  LlmProviderInterface,
  LlmRequest,
  LlmConfig,
} from '../types';
import { getModel } from '@/server/llm-config/models';

const DEFAULT_TIMEOUT_MS = 60_000;

interface AnthropicProviderConfig {
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
  const modelFromConfig = getModel('anthropic', taskType);
  
  // Check for legacy env vars or new override
  const envModel = process.env.ANTHROPIC_MODEL || 
                   (taskType === 'summary' || taskType === 'summarize' 
                     ? process.env.ANTHROPIC_SUMMARY_MODEL 
                     : undefined) ||
                   (taskType === 'qa' || taskType === 'question' 
                     ? process.env.ANTHROPIC_QA_MODEL 
                     : undefined);
  
  return envModel || modelFromConfig;
}

function getAnthropicConfig(config?: LlmConfig): AnthropicProviderConfig {
  const apiKey =
    config?.apiKey ??
    requireEnvVar('ANTHROPIC_API_KEY', 'to use Anthropic. Set it in your environment.');
  const baseUrl =
    (config?.baseUrl as string) ??
    process.env.ANTHROPIC_API_BASE_URL ??
    'https://api.anthropic.com';
  const model =
    (config?.model as string) ?? getDefaultModel();

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    timeoutMs:
      (config?.timeoutMs as number) ??
      Number(process.env.ANTHROPIC_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

export class AnthropicProvider implements LlmProviderInterface {
  private config: AnthropicProviderConfig;
  private taskType?: string;

  constructor(config?: LlmConfig, taskType?: string) {
    this.config = getAnthropicConfig(config);
    this.taskType = taskType;
  }

  async generateJson(
    request: LlmRequest,
    _options?: { taskName?: string },
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      };

      // Anthropic uses tool_use for structured output
      // For now, we'll request JSON and parse it
      const systemPrompt = `${request.systemPrompt}\n\nYou must respond with valid JSON only. Follow this schema: ${JSON.stringify(request.schema ?? {})}`;

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4096,
          temperature: request.temperature ?? 0.3,
          system: systemPrompt,
          messages: [
            {
              role: 'user',
              content: request.userPrompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response
          .text()
          .catch(() => 'Unable to read response body.');
        throw new Error(
          `Anthropic request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const content = payload.content as Array<{ type?: string; text?: string }>;

      if (!Array.isArray(content) || content.length === 0) {
        throw new Error('Anthropic response did not include content.');
      }

      const textContent = content.find((item) => item.type === 'text')?.text;

      if (typeof textContent !== 'string' || !textContent.trim()) {
        throw new Error('Anthropic response did not include text content.');
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01',
      };

      const response = await fetch(`${this.config.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          max_tokens: 4096,
          temperature: request.temperature ?? 0.3,
          system: request.systemPrompt,
          messages: [
            {
              role: 'user',
              content: request.userPrompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response
          .text()
          .catch(() => 'Unable to read response body.');
        throw new Error(
          `Anthropic request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const content = payload.content as Array<{ type?: string; text?: string }>;

      if (!Array.isArray(content) || content.length === 0) {
        throw new Error('Anthropic response did not include content.');
      }

      const textContent = content.find((item) => item.type === 'text')?.text;

      if (typeof textContent !== 'string' || !textContent.trim()) {
        throw new Error('Anthropic response did not include text content.');
      }

      return textContent.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  getProviderName(): LlmProvider {
    return 'anthropic';
  }
}

