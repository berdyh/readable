"use client";

import { useCallback, useMemo, useState } from "react";

import type { QuestionSelection } from "@/server/qa/types";
import {
  filterSlashCommands,
  readSlashToken,
  type SlashCommandDefinition,
} from "../model/slashCommands";

/**
 * Slash-menu state for the inline composer: which commands match the typed
 * token, which one is highlighted, and how arrow/enter/escape resolve.
 * Knows nothing about sending — it hands the caller a built question.
 */
export function useSlashCommandMenu({
  draft,
  selection,
  onDraftChange,
  onApply,
}: {
  draft: string;
  selection?: QuestionSelection;
  onDraftChange: (value: string) => void;
  onApply: (question: string, selection?: QuestionSelection) => void;
}) {
  const token = readSlashToken(draft);
  const isOpen = token !== null;
  const commands = useMemo(() => (token === null ? [] : filterSlashCommands(token)), [token]);

  // The highlight is stored with the token it belongs to, so retyping the
  // query resets the selection by derivation rather than by a reset effect.
  const [highlight, setHighlight] = useState<{ token: string | null; index: number }>({
    token: null,
    index: 0,
  });
  const activeIndex = highlight.token === token ? highlight.index : 0;
  const setActiveIndex = useCallback((index: number) => setHighlight({ token, index }), [token]);

  const applyCommand = useCallback(
    (definition: SlashCommandDefinition) => {
      const result = definition.buildQuestion({ selection, draft });
      onDraftChange(result.question);

      if (result.autoSubmit) {
        onApply(result.question, result.selection ?? selection);
      }

      return result;
    },
    [draft, onApply, onDraftChange, selection],
  );

  /**
   * Returns true when the menu consumed the key, so the composer can decide
   * whether Enter should still submit.
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!isOpen || commands.length === 0) {
        return false;
      }

      switch (event.key) {
        case "ArrowDown":
        case "Tab":
          event.preventDefault();
          setActiveIndex(activeIndex + 1 >= commands.length ? 0 : activeIndex + 1);
          return true;
        case "ArrowUp":
          event.preventDefault();
          setActiveIndex(activeIndex - 1 < 0 ? commands.length - 1 : activeIndex - 1);
          return true;
        case "Enter":
          if (event.shiftKey) return false;
          event.preventDefault();
          applyCommand(commands[activeIndex] ?? commands[0]);
          return true;
        case "Escape":
          event.preventDefault();
          onDraftChange("");
          return true;
        default:
          return false;
      }
    },
    [activeIndex, applyCommand, commands, isOpen, onDraftChange, setActiveIndex],
  );

  const selectById = useCallback(
    (id: string) => {
      const definition = commands.find((item) => item.option.id === id);
      if (definition) {
        applyCommand(definition);
      }
    },
    [applyCommand, commands],
  );

  return {
    isOpen: isOpen && commands.length > 0,
    options: commands.map((definition) => definition.option),
    activeIndex,
    setActiveIndex,
    handleKeyDown,
    selectById,
  };
}
