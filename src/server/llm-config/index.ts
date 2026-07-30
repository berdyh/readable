import promptsData from "./prompts.json";
export * from "./models";

export interface PromptConfig {
  system: {
    paper_summary: { base: string };
    term_grounding: { base: string };
    eval_judge: { base: string };
    selection_summary: { base: string };
    qa: { base: string };
  };
  user: {
    paper_summary: {
      requirements: string[];
    };
  };
  limits: {
    context_char_budget: number;
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
 * Get system prompt for a specific task.
 *
 * There is no persona-prefix layer. One existed when prompts were sourced from
 * Kontext.dev; it was removed, but the `persona_prefix` keys were left behind in
 * prompts.json for a while afterwards, where setting one produced silence rather
 * than an error. They are gone now — the base prompt is returned as-is.
 */
export function getSystemPrompt(
  taskType: "paper_summary" | "term_grounding" | "eval_judge" | "selection_summary" | "qa",
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
