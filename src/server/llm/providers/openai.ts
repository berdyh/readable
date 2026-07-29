import type { LlmProvider, LlmProviderInterface, LlmRequest, LlmConfig } from "../types";
import { getModel } from "@/server/llm-config";
import { getTimeout } from "@/server/config";

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
  // Priority: task-specific env > general OPENAI_MODEL > catalog. Same
  // shape as `getModel()` so the documented OPENAI_QA_MODEL override
  // actually wins when both it and OPENAI_MODEL are set.
  const taskEnv = (() => {
    if (taskType === "summary" || taskType === "summarize" || taskType === "paper_summary") {
      return process.env.OPENAI_SUMMARY_MODEL;
    }
    if (taskType === "qa" || taskType === "question") {
      return process.env.OPENAI_QA_MODEL;
    }
    if (taskType === "selection_summary" || taskType === "inline_summary") {
      return process.env.OPENAI_SELECTION_SUMMARY_MODEL;
    }
    return undefined;
  })();

  if (taskEnv && taskEnv.trim()) return taskEnv.trim();
  if (process.env.OPENAI_MODEL?.trim()) return process.env.OPENAI_MODEL.trim();

  return getModel("openai", taskType);
}

function getOpenAiConfig(config?: LlmConfig, taskType?: string): OpenAiProviderConfig {
  const apiKey =
    config?.apiKey ?? requireEnvVar("OPENAI_API_KEY", "to use OpenAI. Set it in your environment.");
  const baseUrl =
    (config?.baseUrl as string) ?? process.env.OPENAI_API_BASE_URL ?? "https://api.openai.com/v1";
  const model = (config?.model as string) ?? getDefaultModel(taskType);

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    organization: (config?.organization as string) ?? process.env.OPENAI_ORGANIZATION,
    project: (config?.project as string) ?? process.env.OPENAI_PROJECT,
    timeoutMs:
      (config?.timeoutMs as number) ??
      // getTimeout() applies the OPENAI_TIMEOUT_MS override itself.
      getTimeout("openai", "OPENAI_TIMEOUT_MS"),
  };
}

export class OpenAiProvider implements LlmProviderInterface {
  private config: OpenAiProviderConfig;
  private taskType?: string;

  constructor(config?: LlmConfig, taskType?: string) {
    this.config = getOpenAiConfig(config, taskType);
    this.taskType = taskType;
  }

  async generateJson(request: LlmRequest, options?: { taskName?: string }): Promise<string> {
    // The constructor already resolved this.config.model with proper
    // priority (explicit config.model > task-specific env > general env
    // > catalog). Re-deriving here would discard the routing layer's
    // explicit per-request model selection. See Devin review on PR #16.
    // (options.taskName is still consumed below for the json_schema
    // name field.)
    const model = this.config.model;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      };

      if (this.config.organization) {
        headers["OpenAI-Organization"] = this.config.organization;
      }

      if (this.config.project) {
        headers["OpenAI-Project"] = this.config.project;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          temperature: request.temperature ?? 0.3,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: options?.taskName ?? "llm_response",
              schema: request.schema ?? {},
              strict: true,
            },
          },
          messages: [
            {
              role: "system",
              content: request.systemPrompt,
            },
            {
              role: "user",
              content: request.userPrompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "Unable to read response body.");
        throw new Error(`OpenAI request failed with status ${response.status}: ${body}`);
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
      const finishReason = firstChoice?.finish_reason;

      if (finishReason && finishReason !== "stop") {
        throw new Error(`OpenAI response finished with reason: ${finishReason}`);
      }

      const content = firstChoice?.message?.content;

      if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenAI response did not include content.");
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
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      };

      if (this.config.organization) {
        headers["OpenAI-Organization"] = this.config.organization;
      }

      if (this.config.project) {
        headers["OpenAI-Project"] = this.config.project;
      }

      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: this.config.model,
          temperature: request.temperature ?? 0.3,
          messages: [
            {
              role: "system",
              content: request.systemPrompt,
            },
            {
              role: "user",
              content: request.userPrompt,
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "Unable to read response body.");
        throw new Error(`OpenAI request failed with status ${response.status}: ${body}`);
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

      if (typeof content !== "string" || !content.trim()) {
        throw new Error("OpenAI response did not include content.");
      }

      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  getProviderName(): LlmProvider {
    return "openai";
  }
}
