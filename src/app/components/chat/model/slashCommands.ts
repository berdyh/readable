/**
 * The inline panel's slash-command catalogue. Data + pure filtering only, so the
 * wording and the matching rules are testable without rendering anything.
 */
import type { QuestionSelection } from "@/server/qa/types";

import { quotePassage } from "./prompts";

export interface SlashCommandOption {
  id: string;
  label: string;
  description: string;
}

export interface SlashCommandResult {
  question: string;
  selection?: QuestionSelection;
  autoSubmit?: boolean;
}

export interface SlashCommandDefinition {
  option: SlashCommandOption;
  buildQuestion: (context: { selection?: QuestionSelection; draft: string }) => SlashCommandResult;
}

/**
 * Each command has a selection-aware form and a whole-paper fallback. The
 * fallbacks are deliberately paper-agnostic — they run against whatever paper
 * the panel is mounted on.
 */
export const SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    option: {
      id: "explain",
      label: "Explain",
      description: "Break the highlighted passage down in plain language.",
    },
    buildQuestion: ({ selection }) =>
      selection?.text
        ? {
            question: `Explain this passage in the paper:\n${quotePassage(selection.text, 220)}`,
            selection,
            autoSubmit: true,
          }
        : {
            question: "Explain the core method this paper introduces, in plain language.",
            autoSubmit: true,
          },
  },
  {
    option: {
      id: "compare",
      label: "Compare",
      description: "Contrast this work with the baselines it reports.",
    },
    buildQuestion: ({ selection }) =>
      selection?.text
        ? {
            question: `Compare this idea with the baselines the paper reports:\n${quotePassage(selection.text, 200)}`,
            selection,
            autoSubmit: true,
          }
        : {
            question: "Compare this paper's approach with the baselines it evaluates against.",
            autoSubmit: true,
          },
  },
  {
    option: {
      id: "eli5",
      label: "ELI5",
      description: "Explain like I’m five without losing accuracy.",
    },
    buildQuestion: ({ selection }) =>
      selection?.text
        ? {
            question: `Explain this passage like I’m five. Keep it grounded in the paper:\n${quotePassage(selection.text, 200)}`,
            selection,
            autoSubmit: true,
          }
        : {
            question: "Explain this paper like I’m five, sticking to grounded facts.",
            autoSubmit: true,
          },
  },
  {
    option: {
      id: "depth+",
      label: "Depth +",
      description: "Ask for a deeper technical dive on the selection.",
    },
    buildQuestion: ({ selection }) =>
      selection?.text
        ? {
            question: `Go deeper on the technical details in this passage. Include math or training nuances when relevant:\n${quotePassage(selection.text, 220)}`,
            selection,
            autoSubmit: true,
          }
        : {
            question: "Give a deeper technical explanation of this paper's central mechanism.",
            autoSubmit: true,
          },
  },
  {
    option: {
      id: "depth-",
      label: "Depth −",
      description: "Zoom out for a high-level readout.",
    },
    buildQuestion: ({ selection }) =>
      selection?.text
        ? {
            question: `Summarize this concept at a strategic level for a product lead:\n${quotePassage(selection.text, 200)}`,
            selection,
            autoSubmit: true,
          }
        : {
            question: "Summarize this paper's key contribution at a level suitable for stakeholders.",
            autoSubmit: true,
          },
  },
];

/** The `/token` currently typed, or `null` when the menu should stay closed. */
export function readSlashToken(draft: string): string | null {
  const trimmed = draft.trimStart();
  if (!trimmed.startsWith("/") || trimmed.includes("\n")) {
    return null;
  }

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex !== -1) {
    return null;
  }

  return trimmed.slice(1);
}

export function filterSlashCommands(token: string): SlashCommandDefinition[] {
  const query = token.toLowerCase();
  if (!query) {
    return SLASH_COMMANDS;
  }

  return SLASH_COMMANDS.filter(({ option }) => {
    return option.id.toLowerCase().startsWith(query) || option.label.toLowerCase().includes(query);
  });
}
