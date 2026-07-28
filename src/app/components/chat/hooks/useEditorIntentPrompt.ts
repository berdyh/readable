"use client";

import { useEffect } from "react";

import { EDITOR_INTENT_EVENT, type EditorIntentDetail } from "../../block-editor/intents";
import { buildEditorIntentPrompt } from "../model/prompts";

/**
 * Chat half of the editor → chat seam: turn an `editor-ai-action` CustomEvent
 * into composer text and focus the composer. The event contract itself is owned
 * by `block-editor/intents.ts`.
 */
export function useEditorIntentPrompt({
  onPrompt,
  onFocus,
}: {
  onPrompt: (prompt: string) => void;
  onFocus?: () => void;
}) {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<EditorIntentDetail>).detail;
      const normalized = detail?.text?.trim();
      if (!normalized) {
        return;
      }

      onPrompt(buildEditorIntentPrompt(detail.action, normalized));
      onFocus?.();
    };

    window.addEventListener(EDITOR_INTENT_EVENT, handler);
    return () => window.removeEventListener(EDITOR_INTENT_EVENT, handler);
  }, [onFocus, onPrompt]);
}
