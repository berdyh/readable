"use client";

import { useCallback, useEffect, useState } from "react";

import { EDITOR_INTENT_EVENT, type EditorIntentDetail } from "../editor/intents";

const truncateForPrompt = (text: string, maxLength = 80) => {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}…`;
};

export const useWorkspaceStatus = () => {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const clearStatus = useCallback(() => {
    setStatusMessage(null);
  }, []);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStatusMessage(null);
    }, 4200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [statusMessage]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<EditorIntentDetail>).detail;
      if (!detail?.text) {
        return;
      }

      setStatusMessage(
        `Notebook note seeded from selection: ${truncateForPrompt(detail.text)}`,
      );
    };

    window.addEventListener(EDITOR_INTENT_EVENT, handler);
    return () => window.removeEventListener(EDITOR_INTENT_EVENT, handler);
  }, []);

  return {
    statusMessage,
    setStatusMessage,
    clearStatus,
  };
};
