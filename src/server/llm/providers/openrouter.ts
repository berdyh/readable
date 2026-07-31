import type { LlmProvider, LlmProviderInterface, LlmRequest, LlmConfig } from "../types";
import { getModel } from "@/server/llm-config";
import { getTimeout } from "@/server/config";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_REFERER = "https://github.com/berdyh/readable";
const DEFAULT_TITLE = "Readable";
const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-instruct:free";

interface OpenRouterProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  fallbackModels: string[];
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

function taskSpecificEnvKeys(taskType: string | undefined, suffix = "MODEL"): string[] {
  const normalized = taskType?.toLowerCase().replace(/-/g, "_");

  if (normalized === "paper_summary" || normalized === "summary" || normalized === "summarize") {
    return [`OPENROUTER_SUMMARY_${suffix}`, `OPENROUTER_PAPER_SUMMARY_${suffix}`];
  }

  if (normalized === "selection_summary" || normalized === "inline_summary") {
    return [`OPENROUTER_INLINE_${suffix}`, `OPENROUTER_SELECTION_SUMMARY_${suffix}`];
  }

  if (normalized === "qa" || normalized === "question") {
    return [`OPENROUTER_QA_${suffix}`];
  }

  return [];
}

function getFirstEnvValue(keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function splitModelList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function getDefaultModel(taskType?: string): string {
  // Priority: task-specific env > general OPENROUTER_MODEL > catalog
  // (models.json). Task-specific must win — `OPENROUTER_MODEL` is the
  // catch-all and shouldn't shadow `OPENROUTER_QA_MODEL` etc. (Same
  // shape as `getModel()` in llm-config/models.ts.)
  const taskEnv = getFirstEnvValue(taskSpecificEnvKeys(taskType));

  if (taskEnv && taskEnv.trim()) return taskEnv.trim();
  if (process.env.OPENROUTER_MODEL?.trim()) return process.env.OPENROUTER_MODEL.trim();

  try {
    return getModel("openrouter" as "openai", taskType);
  } catch {
    return DEFAULT_MODEL;
  }
}

function getFallbackModels(taskType: string | undefined, primaryModel: string): string[] {
  const configured = [
    ...taskSpecificEnvKeys(taskType, "FALLBACK_MODELS"),
    ...taskSpecificEnvKeys(taskType, "FALLBACK_MODEL"),
    "OPENROUTER_FALLBACK_MODELS",
    "OPENROUTER_FALLBACK_MODEL",
  ].flatMap((key) => splitModelList(process.env[key]));

  const seen = new Set<string>([primaryModel]);
  const result: string[] = [];
  for (const model of configured) {
    if (seen.has(model)) continue;
    seen.add(model);
    result.push(model);
  }
  return result;
}

function getConfigFallbackModels(config?: LlmConfig): string[] | undefined {
  const value = config?.fallbackModels;
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "string") {
    return splitModelList(value);
  }
  return undefined;
}

function getOpenRouterConfig(config?: LlmConfig, taskType?: string): OpenRouterProviderConfig {
  const apiKey =
    config?.apiKey ??
    requireEnvVar("OPENROUTER_API_KEY", "to use OpenRouter. Set it in .env.local.");
  const baseUrl =
    (config?.baseUrl as string) ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL;
  const model = (config?.model as string) ?? getDefaultModel(taskType);
  const fallbackModels = getConfigFallbackModels(config) ?? getFallbackModels(taskType, model);

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    model,
    fallbackModels,
    referer: (config?.referer as string) ?? process.env.OPENROUTER_HTTP_REFERER ?? DEFAULT_REFERER,
    title: (config?.title as string) ?? process.env.OPENROUTER_X_TITLE ?? DEFAULT_TITLE,
    timeoutMs:
      (config?.timeoutMs as number) ??
      // getTimeout() applies the OPENROUTER_TIMEOUT_MS override itself.
      getTimeout("openrouter", "OPENROUTER_TIMEOUT_MS"),
  };
}

function buildHeaders(cfg: OpenRouterProviderConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${cfg.apiKey}`,
    "HTTP-Referer": cfg.referer,
    "X-OpenRouter-Title": cfg.title,
  };
}

function withNativeFallbacks<T extends Record<string, unknown>>(
  cfg: OpenRouterProviderConfig,
  body: T,
): T & { models?: string[] } {
  if (cfg.fallbackModels.length === 0) return body;
  return {
    ...body,
    models: cfg.fallbackModels,
  };
}

export class OpenRouterProvider implements LlmProviderInterface {
  private config: OpenRouterProviderConfig;
  private taskType?: string;

  constructor(config?: LlmConfig, taskType?: string) {
    this.config = getOpenRouterConfig(config, taskType);
    this.taskType = taskType;
  }

  async generateJson(request: LlmRequest, _options?: { taskName?: string }): Promise<string> {
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
      : "";

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: buildHeaders(this.config),
        body: JSON.stringify(
          withNativeFallbacks(this.config, {
            model,
            temperature: request.temperature ?? 0.3,
            response_format: { type: "json_object" },
            // Route only to upstreams that honour response_format, and never
            // let OpenRouter silently compress the prompt to fit a smaller
            // provider window. Observed failure without these: DeepInfra
            // served deepseek with the prompt cut to exactly 2048 tokens and
            // the model answered `{}` — a 200 that no fallback ever caught.
            provider: { require_parameters: true, ignore: ["DeepInfra"] },
            transforms: [],
            messages: [
              {
                role: "system",
                content: `${request.systemPrompt}${schemaHint}`,
              },
              { role: "user", content: request.userPrompt },
            ],
          }),
        ),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "Unable to read response body.");
        throw new Error(`OpenRouter request failed with status ${response.status}: ${body}`);
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
        throw new Error("OpenRouter response did not include content.");
      }

      // A syntactically valid but empty payload ({} / []) is a silent no-op —
      // the worst failure mode, because nothing downstream errors until a
      // parser finds no data. Fail loudly so failover can classify it.
      if (content.trim() === "{}" || content.trim() === "[]") {
        throw new Error("OpenRouter response was an empty JSON payload (degenerate completion).");
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
        method: "POST",
        headers: buildHeaders(this.config),
        body: JSON.stringify(
          withNativeFallbacks(this.config, {
            model: this.config.model,
            temperature: request.temperature ?? 0.3,
            // Same anti-truncation guard as the JSON path (see above).
            transforms: [],
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
          }),
        ),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "Unable to read response body.");
        throw new Error(`OpenRouter request failed with status ${response.status}: ${body}`);
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
        throw new Error("OpenRouter response did not include content.");
      }

      // A syntactically valid but empty payload ({} / []) is a silent no-op —
      // the worst failure mode, because nothing downstream errors until a
      // parser finds no data. Fail loudly so failover can classify it.
      if (content.trim() === "{}" || content.trim() === "[]") {
        throw new Error("OpenRouter response was an empty JSON payload (degenerate completion).");
      }

      return content.trim();
    } finally {
      clearTimeout(timer);
    }
  }

  getProviderName(): LlmProvider {
    return "openrouter";
  }
}
