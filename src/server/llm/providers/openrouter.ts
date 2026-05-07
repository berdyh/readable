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
  // Priority: task-specific env > general OPENROUTER_MODEL > catalog
  // (models.json). Task-specific must win — `OPENROUTER_MODEL` is the
  // catch-all and shouldn't shadow `OPENROUTER_QA_MODEL` etc. (Same
  // shape as `getModel()` in llm-config/models.ts.)
  const taskEnv = (() => {
    if (taskType === 'summary' || taskType === 'summarize' || taskType === 'paper_summary') {
      return process.env.OPENROUTER_SUMMARY_MODEL;
    }
    if (taskType === 'qa' || taskType === 'question') {
      return process.env.OPENROUTER_QA_MODEL;
    }
    if (taskType === 'selection_summary' || taskType === 'inline_summary') {
      return process.env.OPENROUTER_INLINE_MODEL;
    }
    return undefined;
  })();

  if (taskEnv && taskEnv.trim()) return taskEnv.trim();
  if (process.env.OPENROUTER_MODEL?.trim()) return process.env.OPENROUTER_MODEL.trim();

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
    _options?: { taskName?: string },
  ): Promise<string> {
    // Use the model the constructor resolved (which already honors
    // explicit config.model from the routing layer plus task-specific
    // env vars). Re-deriving here used to ignore the routing layer's
    // selected model whenever a taskName was present — see Devin
    // review on PR #16. If the caller wants a different model per call,
    // pass `provider: <id>` + `model: <id>` via createLlmProvider.
    const model = this.config.model;

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
