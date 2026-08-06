import modelsData from "./models.json";

export interface ModelConfig {
  model: string;
  rationale: string;
  pricing?: {
    input_per_1m: number;
    output_per_1m: number;
  };
}

export interface ProviderModels {
  paper_summary: ModelConfig;
  selection_summary: ModelConfig;
  qa: ModelConfig;
  /** Pinned judge for `pnpm eval` — a dated snapshot, never a floating alias. */
  eval_judge: ModelConfig;
  default: ModelConfig;
}

export interface ModelsConfig {
  openai: ProviderModels;
  anthropic: ProviderModels;
  gemini: ProviderModels;
  openrouter: ProviderModels;
  notes: {
    selection_strategy: string;
    customization: string;
    update_date: string;
  };
}

/**
 * Get model for a specific provider and task type
 */
export function getModel(
  provider: "openai" | "anthropic" | "gemini" | "openrouter",
  taskType?: string | "paper_summary" | "selection_summary" | "qa" | "default",
): string {
  const config = modelsData[provider];

  // Map task names to config keys
  let taskKey: "paper_summary" | "selection_summary" | "qa" | "eval_judge" | "default" = "default";

  if (!taskType) {
    taskKey = "default";
  } else {
    // Handle aliases and map to correct task keys
    const normalized = taskType.toLowerCase().replace(/-/g, "_");

    // Check exact matches first (including the actual config keys)
    if (normalized === "paper_summary" || normalized === "summary" || normalized === "summarize") {
      taskKey = "paper_summary";
    } else if (normalized === "selection_summary" || normalized === "inline_summary") {
      taskKey = "selection_summary";
    } else if (normalized === "qa" || normalized === "question") {
      taskKey = "qa";
    } else if (normalized === "eval_judge" || normalized === "judge") {
      taskKey = "eval_judge";
    } else if (normalized === "default") {
      taskKey = "default";
    }
    // If no match found, taskKey remains 'default' as initialized
  }

  // Get task-specific model or fall back to default
  const taskConfig = config[taskKey];
  if (!taskConfig) {
    return config.default.model;
  }

  // Check for environment variable override (e.g., OPENAI_QA_MODEL, ANTHROPIC_PAPER_SUMMARY_MODEL)
  const providerUpper = provider.toUpperCase();
  // Keep underscores in task key for env var names (e.g., PAPER_SUMMARY, not PAPERSUMMARY)
  const taskUpper = taskKey.toUpperCase();
  const envKey = `${providerUpper}_${taskUpper}_MODEL`;
  const envOverride = process.env[envKey];

  if (envOverride) {
    return envOverride;
  }

  return taskConfig.model;
}

/**
 * Get full model configuration
 */
export function getModelConfig(
  provider: "openai" | "anthropic" | "gemini" | "openrouter",
  taskType?: string | "paper_summary" | "selection_summary" | "qa" | "default",
): ModelConfig {
  const config = modelsData[provider];

  // Map task names to config keys
  let taskKey: "paper_summary" | "selection_summary" | "qa" | "eval_judge" | "default" = "default";

  if (!taskType) {
    taskKey = "default";
  } else {
    // Handle aliases and map to correct task keys (matching getModel logic)
    const normalized = taskType.toLowerCase().replace(/-/g, "_");

    // Check exact matches first (including the actual config keys)
    if (normalized === "paper_summary" || normalized === "summary" || normalized === "summarize") {
      taskKey = "paper_summary";
    } else if (normalized === "selection_summary" || normalized === "inline_summary") {
      taskKey = "selection_summary";
    } else if (normalized === "qa" || normalized === "question") {
      taskKey = "qa";
    } else if (normalized === "eval_judge" || normalized === "judge") {
      taskKey = "eval_judge";
    } else if (normalized === "default") {
      taskKey = "default";
    }
    // If no match found, taskKey remains 'default' as initialized
  }

  return config[taskKey] ?? config.default;
}

/**
 * Export the full models configuration
 */
export function getModelsConfig(): ModelsConfig {
  return modelsData as ModelsConfig;
}
