import promptsData from './prompts.json';
export * from './models';

export interface PromptConfig {
  system: {
    paper_summary: {
      base: string;
      persona_prefix: string;
    };
    selection_summary: {
      base: string;
      persona_prefix: string;
    };
    qa: {
      base: string;
      persona_prefix: string;
    };
  };
  user: {
    paper_summary: {
      requirements: string[];
    };
  };
  limits: {
    section: number;
    paragraph: number;
    figure: number;
    paragraph_truncate: number;
    figure_caption_truncate: number;
    figure_context_truncate: number;
    abstract_truncate: number;
    text_truncate: number;
  };
}

/**
 * Get system prompt for a specific task. The persona-prefix layer
 * (previously sourced from Kontext.dev) was removed; the base prompt
 * from prompts.json is now returned as-is.
 */
export function getSystemPrompt(
  taskType: 'paper_summary' | 'selection_summary' | 'qa',
): string {
  return promptsData.system[taskType].base;
}

/**
 * Get user prompt requirements for paper summary
 */
export function getPaperSummaryRequirements(): string[] {
  return promptsData.user.paper_summary.requirements;
}

/**
 * Get prompt limits/constants
 */
export function getPromptLimits() {
  return promptsData.limits;
}

/**
 * Export the full prompts configuration
 */
export function getPromptsConfig(): PromptConfig {
  return promptsData as PromptConfig;
}

