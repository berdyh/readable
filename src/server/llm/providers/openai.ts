import type {
  LlmProvider,
  LlmProviderInterface,
  LlmRequest,
  LlmConfig,
} from '../types';
import { getModel } from '@/server/llm-config/models';

const DEFAULT_TIMEOUT_MS = 60_000;

interface OpenAiProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  organization?: string;
  project?: string;
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
  const modelFromConfig = getModel('openai', taskType);
  
  // Check for legacy env vars or new override
  const envModel = process.env.OPENAI_MODEL || 
                   (taskType === 'summary' || taskType === 'summarize' 
                     ? process.env.OPENAI_SUMMARY_MODEL 
                     : undefined) ||
                   (taskType === 'qa' || taskType === 'question' 
                     ? process.env.OPENAI_QA_MODEL 
                     : undefined);
  
  return envModel || modelFromConfig;
}

function getOpenAiConfig(config?: LlmConfig): OpenAiProviderConfig {
  const apiKey =
    config?.apiKey ??
    requireEnvVar('OPENAI_API_KEY', 'to use OpenAI. Set it in your environment.');
  const baseUrl =
    config?.baseUrl ??
    requireEnvVar(
      'OPENAI_API_BASE_URL',
      'to use OpenAI. Update .env.local if needed.',
    );
  const model =
    config?.model ??
    requireEnvVar(
      'OPENAI_MODEL',
      'for OpenAI. Update .env.local if needed.',
    );

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    model,
    organization: (config?.organization as string) ?? process.env.OPENAI_ORGANIZATION,
    project: (config?.project as string) ?? process.env.OPENAI_PROJECT,
    timeoutMs:
      (config?.timeoutMs as number) ??
      Number(process.env.OPENAI_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
  };
}

export class OpenAiProvider implements LlmProviderInterface {
  private config: OpenAiProviderConfig;
  private taskType?: string;

  constructor(config?: LlmConfig, taskType?: string) {
    this.config = getOpenAiConfig(config);
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

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      };

      if (this.config.organization) {
        headers['OpenAI-Organization'] = this.config.organization;
      }

      if (this.config.project) {
        headers['OpenAI-Project'] = this.config.project;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          temperature: request.temperature ?? 0.3,
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: options?.taskName ?? 'llm_response',
              schema: request.schema ?? {},
              strict: true,
            },
          },
          messages: [
            {
              role: 'system',
              content: request.systemPrompt,
            },
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
          `OpenAI request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const choices = payload.choices as Array<
        {
          message?: { content?: string };
          finish_reason?: string;
        } | undefined
      >;

      const firstChoice = choices?.[0];
      const finishReason = firstChoice?.finish_reason;

      if (finishReason && finishReason !== 'stop') {
        throw new Error(`OpenAI response finished with reason: ${finishReason}`);
      }

      const content = firstChoice?.message?.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('OpenAI response did not include content.');
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
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
      };

      if (this.config.organization) {
        headers['OpenAI-Organization'] = this.config.organization;
      }

      if (this.config.project) {
        headers['OpenAI-Project'] = this.config.project;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          temperature: request.temperature ?? 0.3,
          messages: [
            {
              role: 'system',
              content: request.systemPrompt,
            },
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
          `OpenAI request failed with status ${response.status}: ${body}`,
        );
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const choices = payload.choices as Array<
        {
          message?: { content?: string };
          finish_reason?: string;
        } | undefined
      >;

      const firstChoice = choices?.[0];
      const content = firstChoice?.message?.content;

      if (typeof content !== 'string' || !content.trim()) {
        throw new Error('OpenAI response did not include content.');
      }

      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  getProviderName(): LlmProvider {
    return 'openai';
  }
}

