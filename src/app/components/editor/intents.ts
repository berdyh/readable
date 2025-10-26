"use client";

export type EditorIntentAction =
  | "summarize-selection"
  | "go-deeper"
  | "condense";

export interface EditorIntentDetail {
  action: EditorIntentAction;
  text: string;
  origin?: string;
}

export const EDITOR_INTENT_EVENT = "editor-ai-action";

export function emitEditorIntent(detail: EditorIntentDetail) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(EDITOR_INTENT_EVENT, { detail }));
}
