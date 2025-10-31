import modelsData from './models.json';

export interface ModelConfig {
  model: string;
  rationale: string;
  pricing?: {
    input_per_1m: number;
    output_per_1m: number;
  };
}

export interface ModelsConfig {
  openai: {
    paper_summary: ModelConfig;
    selection_summary: ModelConfig;
    qa: ModelConfig;
    default: ModelConfig;
  };
  anthropic: {
    paper_summary: ModelConfig;
    selection_summary: ModelConfig;
    qa: ModelConfig;
    default: ModelConfig;
  };
  gemini: {
    paper_summary: ModelConfig;
    selection_summary: ModelConfig;
    qa: ModelConfig;
    default: ModelConfig;
  };
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
  provider: 'openai' | 'anthropic' | 'gemini',
  taskType?: string | 'paper_summary' | 'selection_summary' | 'qa' | 'default',
): string {
  const config = modelsData[provider];
  
  // Map task names to config keys
  let taskKey: 'paper_summary' | 'selection_summary' | 'qa' | 'default' = 'default';
  
  if (!taskType) {
    taskKey = 'default';
  } else {
    // Handle aliases and map to correct task keys
    const normalized = taskType.toLowerCase();
    if (normalized === 'summary' || normalized === 'summarize' || normalized === 'paper_summary') {
      taskKey = 'paper_summary';
    } else if (normalized === 'inline_summary' || normalized === 'selection_summary') {
      taskKey = 'selection_summary';
    } else if (normalized === 'question' || normalized === 'qa') {
      taskKey = 'qa';
    } else if (normalized === 'default') {
      taskKey = 'default';
    }
  }
  
  // Get task-specific model or fall back to default
  const taskConfig = config[taskKey];
  if (!taskConfig) {
    return config.default.model;
  }
  
  // Check for environment variable override (e.g., OPENAI_QA_MODEL, ANTHROPIC_SUMMARY_MODEL)
  const providerUpper = provider.toUpperCase();
  const taskUpper = taskKey.toUpperCase().replace('_', '');
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
  provider: 'openai' | 'anthropic' | 'gemini',
  taskType: 'paper_summary' | 'selection_summary' | 'qa' | 'default',
): ModelConfig {
  const config = modelsData[provider];
  
  // Map task names to config keys
  let taskKey: 'paper_summary' | 'selection_summary' | 'qa' | 'default' = taskType;
  
  if (taskType === 'summary' || taskType === 'summarize') {
    taskKey = 'paper_summary';
  } else if (taskType === 'inline_summary') {
    taskKey = 'selection_summary';
  } else if (taskType === 'question') {
    taskKey = 'qa';
  }
  
  return config[taskKey] ?? config.default;
}

/**
 * Export the full models configuration
 */
export function getModelsConfig(): ModelsConfig {
  return modelsData as ModelsConfig;
}

