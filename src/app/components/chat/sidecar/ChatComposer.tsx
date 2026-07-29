"use client";

import { BookOpenText, Loader2, Send, Upload } from "lucide-react";

import { PromptInputTextarea } from "../primitives/prompt-input";

/**
 * Everything below the transcript: the pinned selection, the panel error, the
 * insert-answer action, and the prompt box. Stacked in escalating priority so
 * the error is never below the control it explains.
 */
export function ChatComposer({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  selectedText,
  onSelectionClear,
  error,
  canInsertAnswer,
  onInsertAnswer,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  selectedText?: string;
  onSelectionClear?: () => void;
  error?: string | null;
  canInsertAnswer: boolean;
  onInsertAnswer: () => void;
}) {
  return (
    <footer className="shrink-0 border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {selectedText && (
        <div className="border-b border-amber-200 bg-amber-50/60 px-4 py-2.5 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/20 dark:text-amber-200">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 font-medium">
              <BookOpenText className="h-3.5 w-3.5" aria-hidden="true" />
              Selected context
            </span>
            <button
              type="button"
              onClick={onSelectionClear}
              className="rounded px-1.5 py-0.5 font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
            >
              Clear
            </button>
          </div>
          <p className="line-clamp-3 whitespace-pre-wrap leading-relaxed">{selectedText}</p>
        </div>
      )}

      {error && (
        <p
          role="alert"
          className="border-b border-rose-200 bg-rose-50/60 px-4 py-2.5 text-xs leading-relaxed text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/20 dark:text-rose-200"
        >
          {error}
        </p>
      )}

      {canInsertAnswer && (
        <div className="flex justify-end border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
          <button
            type="button"
            onClick={onInsertAnswer}
            className="touch-target relative inline-flex h-8 items-center gap-2 rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-700 transition-colors duration-150 hover:border-emerald-400 hover:bg-emerald-50 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-200 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-zinc-50"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            Insert answer into paper
          </button>
        </div>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        className="flex items-end gap-2 px-4 py-3"
      >
        <PromptInputTextarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={selectedText ? "Ask about the selected passage" : "Ask about this paper"}
          disabled={isSubmitting}
          aria-label="Ask about this paper"
          className="flex-1 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={!value.trim() || isSubmitting}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-zinc-950 text-white transition-colors duration-150 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
          aria-label="Send message"
          title="Send message"
        >
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </form>
    </footer>
  );
}
