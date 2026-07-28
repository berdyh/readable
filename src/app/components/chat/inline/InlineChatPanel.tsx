"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { SignInButton, SignUpButton, useUser } from "@clerk/nextjs";
import { Loader2, Sparkles } from "lucide-react";

import type { QuestionSelection } from "@/server/qa/types";

import { askQuestion } from "../api/chatApi";
import { useEditorIntentPrompt } from "../hooks/useEditorIntentPrompt";
import { useSlashCommandMenu } from "../hooks/useSlashCommandMenu";
import { INLINE_QUICK_PROMPTS } from "../model/prompts";
import { createLocalId, type ChatMessage } from "../model/types";
import { AnswerCard } from "../primitives/answer-card";
import { SlashCommandMenu } from "./SlashCommandMenu";

export interface InlineChatPanelProps {
  paperId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
  onQuestionSent?: (question: string) => void;
  onAnswerReceived?: (answer: string) => void;
  onError?: (error: string) => void;
}

function SelectionCallout({
  selection,
  onClear,
}: {
  selection?: QuestionSelection;
  onClear?: () => void;
}) {
  if (!selection?.text) {
    return null;
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-200">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-semibold">Highlight added to prompt</span>
        <p className="line-clamp-3 whitespace-pre-wrap leading-relaxed">
          “{selection.text.trim()}”
        </p>
        {(typeof selection.page === "number" || selection.section) && (
          <div className="flex flex-wrap gap-2 text-[11px] text-amber-700 dark:text-amber-300">
            {typeof selection.page === "number" && <span>Page {selection.page}</span>}
            {selection.section && <span>{selection.section}</span>}
          </div>
        )}
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="shrink-0 rounded px-1.5 py-0.5 font-medium text-amber-800 transition-colors duration-150 hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
        >
          Clear
        </button>
      )}
    </div>
  );
}

/**
 * Ephemeral chat rendered inside a `chat_message` block. Unlike the sidecar it
 * never persists a session — the surrounding block owns the transcript — so it
 * talks to `/api/qa` directly and keeps messages in local state.
 */
export function InlineChatPanel({
  paperId,
  draft,
  onDraftChange,
  selection,
  onSelectionClear,
  onQuestionSent,
  onAnswerReceived,
  onError,
}: InlineChatPanelProps) {
  const { isLoaded, isSignedIn } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const focusComposer = useCallback(() => textareaRef.current?.focus(), []);

  useEditorIntentPrompt({ onPrompt: onDraftChange, onFocus: focusComposer });

  const reportError = useCallback(
    (message: string) => {
      setError(message);
      onError?.(message);
    },
    [onError],
  );

  const sendQuestion = useCallback(
    async (rawQuestion: string, selectionOverride?: QuestionSelection) => {
      const question = rawQuestion.trim();
      if (!question || isSubmitting) {
        return;
      }
      if (!isSignedIn) {
        reportError("Sign in to ask saved questions.");
        return;
      }

      setIsSubmitting(true);
      setError(null);

      setMessages((prev) => [
        ...prev,
        { id: createLocalId("msg"), role: "user", content: question, createdAt: Date.now() },
      ]);
      onQuestionSent?.(question);

      const payloadSelection = selectionOverride ?? selection;

      try {
        const result = await askQuestion({ paperId, question, selection: payloadSelection });

        setMessages((prev) => [
          ...prev,
          {
            id: createLocalId("msg"),
            role: "assistant",
            content: result.answer,
            createdAt: Date.now(),
            citations: result.cites,
            trust: result.trust,
          },
        ]);
        onAnswerReceived?.(result.answer);
        onDraftChange("");

        if (payloadSelection) {
          onSelectionClear?.();
        }
      } catch (caught) {
        reportError(caught instanceof Error ? caught.message : "Unexpected QA error occurred.");
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      isSignedIn,
      onAnswerReceived,
      onDraftChange,
      onQuestionSent,
      onSelectionClear,
      paperId,
      reportError,
      selection,
    ],
  );

  const slashMenu = useSlashCommandMenu({
    draft,
    selection,
    onDraftChange,
    onApply: (question, commandSelection) => void sendQuestion(question, commandSelection),
  });

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (slashMenu.handleKeyDown(event)) {
        return;
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!isSubmitting) {
          void sendQuestion(draft);
        }
      }
    },
    [draft, isSubmitting, sendQuestion, slashMenu],
  );

  return (
    <div className="flex h-full flex-col gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
      <div>
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">Research chat</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Ask grounded questions about this paper.
        </p>
      </div>

      {!isLoaded && (
        <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading chat…
        </div>
      )}

      {isLoaded && !isSignedIn && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          <p className="mb-3">Sign in to use paper chat.</p>
          <div className="flex flex-wrap gap-2">
            <SignInButton>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md bg-zinc-950 px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-800 transition-colors duration-150 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Sign up
              </button>
            </SignUpButton>
          </div>
        </div>
      )}

      {isLoaded && isSignedIn && (
        <>
          <div
            ref={scrollRef}
            className="flex min-h-[220px] flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-start justify-center gap-2">
                <span className="inline-flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                  <Sparkles
                    className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                    aria-hidden="true"
                  />
                  Ask anything about this paper
                </span>
                <div className="flex flex-wrap gap-2">
                  {INLINE_QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendQuestion(prompt)}
                      className="rounded-full border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 transition-colors duration-150 hover:border-emerald-400 hover:bg-emerald-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-zinc-50"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Type <span className="font-medium text-zinc-700 dark:text-zinc-200">/</span> for
                  commands.
                </p>
              </div>
            ) : (
              messages.map((message) =>
                message.role === "user" ? (
                  <div
                    key={message.id}
                    className="max-w-[88%] self-end whitespace-pre-wrap rounded-lg bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-white dark:bg-zinc-100 dark:text-zinc-950"
                  >
                    {message.content}
                  </div>
                ) : (
                  <AnswerCard
                    key={message.id}
                    className="max-w-[88%] self-start"
                    content={message.content}
                    citations={message.citations}
                    trust={message.trust}
                    paperId={paperId}
                  />
                ),
              )
            )}
          </div>

          <SelectionCallout selection={selection} onClear={selection ? onSelectionClear : undefined} />

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-relaxed text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"
            >
              {error}
            </p>
          )}

          <form
            className="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void sendQuestion(draft);
            }}
          >
            <label
              htmlFor={textareaId}
              className="text-xs font-medium text-zinc-600 dark:text-zinc-300"
            >
              Ask a question
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                id={textareaId}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask how the method compares to the baselines…"
                disabled={isSubmitting}
                className="min-h-24 w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-800 outline-none transition-[border-color,box-shadow] duration-150 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-emerald-400 dark:focus:ring-emerald-400/20"
              />
              {slashMenu.isOpen && (
                <SlashCommandMenu
                  options={slashMenu.options}
                  activeIndex={slashMenu.activeIndex}
                  onSelect={(option) => slashMenu.selectById(option.id)}
                  onHighlight={slashMenu.setActiveIndex}
                />
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSubmitting || !draft.trim()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-zinc-900 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                {isSubmitting ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

export default InlineChatPanel;
