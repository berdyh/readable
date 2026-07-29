/**
 * Prompt text the chat surface generates on the user's behalf. Pure string
 * builders so the wording is reviewable in one place instead of inline in JSX.
 */
import type { EditorIntentAction } from "../../block-editor/intents";

/** Starter prompts shown in the sidecar's empty state. */
export const QUICK_PROMPTS = [
  "Summarize this paper",
  "What are the key findings?",
  "What are the main limitations?",
] as const;

/** Starter prompts shown in the inline (in-block) panel's empty state. */
export const INLINE_QUICK_PROMPTS = [
  "What problem does this paper solve?",
  "What is the core method?",
  "How was it evaluated?",
] as const;

export function truncateForPrompt(text: string, length = 240): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= length ? clean : `${clean.slice(0, length)}…`;
}

/** Wrap a passage in the quoting convention every prompt builder uses. */
export function quotePassage(text: string, length = 240): string {
  return `“${truncateForPrompt(text, length)}”`;
}

/**
 * Turn an `editor-ai-action` CustomEvent into composer text.
 * The event contract itself lives in `block-editor/intents.ts`.
 */
export function buildEditorIntentPrompt(action: EditorIntentAction, text: string): string {
  const passage = quotePassage(text);

  switch (action) {
    case "go-deeper":
      return `Dig deeper on this passage. Include derivations or supporting evidence when relevant:\n${passage}`;
    case "condense":
      return `Condense this passage into a concise bullet:\n${passage}`;
    case "summarize-selection":
    default:
      return `Summarize the key insight from this excerpt:\n${passage}`;
  }
}
