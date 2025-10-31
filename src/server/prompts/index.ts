import promptsData from './prompts.json';

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
 * Get system prompt for a specific task
 */
export function getSystemPrompt(
  taskType: 'paper_summary' | 'selection_summary' | 'qa',
  personaPrompt?: string,
): string {
  const config = promptsData.system[taskType];
  const basePrompt = config.base;

  if (!personaPrompt) {
    return basePrompt;
  }

  const trimmed = personaPrompt.trim();
  if (!trimmed) {
    return basePrompt;
  }

  // Use appropriate prefix based on task type
  // For paper_summary, prefix is "---" (separator)
  // For others, prefix is "Persona guidance:" (label)
  const prefix = config.persona_prefix;
  if (taskType === 'paper_summary') {
    return `${trimmed}\n\n${prefix}\n${basePrompt}`;
  }
  return `${basePrompt}\n\n${prefix}\n${trimmed}`;
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

