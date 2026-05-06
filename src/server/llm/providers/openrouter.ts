import type {
  LlmProvider,
  LlmProviderInterface,
  LlmRequest,
  LlmConfig,
} from '../types';
import { getModel } from '@/server/llm-config/models';

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_REFERER = 'https://github.com/berdyh/readable';
const DEFAULT_TITLE = 'Readable';
const DEFAULT_MODEL = 'meta-llama/llama-3.3-70b-instruct:free';

interface OpenRouterProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  referer: string;
  title: string;
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
  const envModel =
    process.env.OPENROUTER_MODEL ||
    (taskType === 'summary' || taskType === 'summarize' || taskType === 'paper_summary'
      ? process.env.OPENROUTER_SUMMARY_MODEL
      : undefined) ||
    (taskType === 'qa' || taskType === 'question'
      ? process.env.OPENROUTER_QA_MODEL
      : undefined) ||
    (taskType === 'selection_summary' || taskType === 'inline_summary'
      ? process.env.OPENROUTER_INLINE_MODEL
      : undefined);

  if (envModel) {
    return envModel;
  }

  try {
    return getModel('openrouter' as 'openai', taskType);
  } catch {
    return DEFAULT_MODEL;
  }
}

function getOpenRouterConfig(
  config?: LlmConfig,
  taskType?: string,
): OpenRouterProviderConfig {
  const apiKey =
    config?.apiKey ??
    requireEnvVar(
      'OPENROUTER_API_KEY',
      'to use OpenRouter. Set it in .env.local.',
    );
  const baseUrl =
    (config?.baseUrl as string) ??
    process.env.OPENROUTER_BASE_URL ??
    DEFAULT_BASE_URL;
  const model = (config?.model as string) ?? getDefaultModel(taskType);

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    referer:
      (config?.referer as string) ??
      process.env.OPENROUTER_HTTP_REFERER ??
      DEFAULT_REFERER,
    title:
      (config?.title as string) ??
      process.env.OPENROUTER_X_TITLE ??
      DEFAULT_TITLE,
    timeoutMs:
      (config?.timeoutMs as number) ??
      Number(process.env.OPENROUTER_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

function buildHeaders(cfg: OpenRouterProviderConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
    'HTTP-Referer': cfg.referer,
    'X-Title': cfg.title,
  };
}

export class OpenRouterProvider implements LlmProviderInterface {
  private config: OpenRouterProviderConfig;
  private taskType?: string;

  constructor(config?: LlmConfig, taskType?: string) {
    this.config = getOpenRouterConfig(config, taskType);
    this.taskType = taskType;
  }

  async generateJson(
    request: LlmRequest,
    options?: { taskName?: string },
  ): Promise<string> {
    const taskName = options?.taskName ?? this.taskType;
    const model = taskName ? getDefaultModel(taskName) : this.config.model;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const schemaHint = request.schema
      ? `\n\nReturn a single JSON object that conforms to this schema:\n${JSON.stringify(request.schema)}`
      : '';

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(this.config),
        body: JSON.stringify({
          model,
          temperature: request.temperature ?? 0.3,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${request.systemPrompt}${schemaHint}`,
            },
            { role: 'user', content: request.userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response
          .text()
          .catch(() => 'Unable to read response body.');
        throw new Error(
          `OpenRouter request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const choices = payload.choices as Array<
        | {
            message?: { content?: string };
            finish_reason?: string;
          }
        | undefined
      >;

      const firstChoice = choices?.[0];
      const content = firstChoice?.message?.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('OpenRouter response did not include content.');
      }

      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  async generateText(request: LlmRequest): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: buildHeaders(this.config),
        body: JSON.stringify({
          model: this.config.model,
          temperature: request.temperature ?? 0.3,
          messages: [
            { role: 'system', content: request.systemPrompt },
            { role: 'user', content: request.userPrompt },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response
          .text()
          .catch(() => 'Unable to read response body.');
        throw new Error(
          `OpenRouter request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const choices = payload.choices as Array<
        | {
            message?: { content?: string };
            finish_reason?: string;
          }
        | undefined
      >;

      const firstChoice = choices?.[0];
      const content = firstChoice?.message?.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('OpenRouter response did not include content.');
      }

      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  getProviderName(): LlmProvider {
    return 'openrouter';
  }
}
