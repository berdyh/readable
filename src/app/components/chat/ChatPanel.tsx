"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { SignInButton, SignUpButton, useUser } from "@clerk/nextjs";

import type { AnswerResult, QuestionSelection } from "@/server/qa/types";

import { AnswerCard, type AnswerTrustMetadata } from "../ai-chatbot/answer-card";
import SlashCommandMenu, { type SlashCommandOption } from "./SlashCommandMenu";
import { EDITOR_INTENT_EVENT, type EditorIntentDetail } from "../block-editor/intents";

type MessageRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  citations?: AnswerResult["cites"];
  trust?: AnswerTrustMetadata;
}

export interface ChatPanelProps {
  paperId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
  onQuestionSent?: (question: string) => void;
  onAnswerReceived?: (answer: string) => void;
  onError?: (error: string) => void;
}

interface SlashCommandDefinition {
  option: SlashCommandOption;
  buildQuestion: (context: { selection?: QuestionSelection; draft: string }) => {
    question: string;
    selection?: QuestionSelection;
    autoSubmit?: boolean;
  };
}

function createMessageId() {
  return `msg_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function truncate(text: string, length = 240) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= length) {
    return clean;
  }
  return `${clean.slice(0, length)}…`;
}

const slashCommandDefinitions: SlashCommandDefinition[] = [
  {
    option: {
      id: "explain",
      label: "Explain",
      description: "Break the highlighted passage down in plain language.",
    },
    buildQuestion: ({ selection }) => {
      if (selection?.text) {
        const snippet = truncate(selection.text, 220);
        return {
          question: `Explain this passage in the paper:\n“${snippet}”`,
          selection,
          autoSubmit: true,
        };
      }

      return {
        question: "Explain the Transformer architecture introduced in this paper.",
        autoSubmit: true,
      };
    },
  },
  {
    option: {
      id: "compare",
      label: "Compare",
      description: "Contrast with recurrent or convolutional baselines.",
    },
    buildQuestion: ({ selection }) => {
      if (selection?.text) {
        const snippet = truncate(selection.text, 200);
        return {
          question: `Compare this idea with earlier neural machine translation baselines:\n“${snippet}”`,
          selection,
          autoSubmit: true,
        };
      }

      return {
        question:
          "Compare the Transformer with recurrent and convolutional NMT baselines in the paper.",
        autoSubmit: true,
      };
    },
  },
  {
    option: {
      id: "eli5",
      label: "ELI5",
      description: "Explain like I’m five without losing accuracy.",
    },
    buildQuestion: ({ selection }) => {
      if (selection?.text) {
        const snippet = truncate(selection.text, 200);
        return {
          question: `Explain this passage like I’m five. Keep it grounded in the paper:\n“${snippet}”`,
          selection,
          autoSubmit: true,
        };
      }

      return {
        question: "Explain the Transformer paper like I’m five, sticking to grounded facts.",
        autoSubmit: true,
      };
    },
  },
  {
    option: {
      id: "depth+",
      label: "Depth +",
      description: "Ask for a deeper technical dive on the selection.",
    },
    buildQuestion: ({ selection }) => {
      if (selection?.text) {
        const snippet = truncate(selection.text, 220);
        return {
          question: `Go deeper on the technical details in this passage. Include math or training nuances when relevant:\n“${snippet}”`,
          selection,
          autoSubmit: true,
        };
      }

      return {
        question:
          "Provide a deeper technical explanation of how multi-head attention works in the Transformer.",
        autoSubmit: true,
      };
    },
  },
  {
    option: {
      id: "depth-",
      label: "Depth −",
      description: "Zoom out for a high-level readout.",
    },
    buildQuestion: ({ selection }) => {
      if (selection?.text) {
        const snippet = truncate(selection.text, 200);
        return {
          question: `Summarize this concept at a strategic level for a product lead:\n“${snippet}”`,
          selection,
          autoSubmit: true,
        };
      }

      return {
        question:
          "Summarize the key contribution of the Transformer at a high-level suitable for stakeholders.",
        autoSubmit: true,
      };
    },
  },
];

const MessageBubble = ({ message, paperId }: { message: ChatMessage; paperId: string }) => {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex max-w-[88%] flex-col gap-3 self-end rounded-lg bg-zinc-900 px-4 py-3 text-sm leading-relaxed text-white shadow-sm dark:bg-zinc-100 dark:text-zinc-950">
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    );
  }

  return (
    <AnswerCard
      className="max-w-[88%] self-start"
      content={message.content}
      citations={message.citations}
      trust={message.trust}
      paperId={paperId}
    />
  );
};

const SelectionCallout = ({
  selection,
  onClear,
}: {
  selection: QuestionSelection | undefined;
  onClear?: () => void;
}) => {
  if (!selection?.text) {
    return null;
  }

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
      <div className="flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wide text-amber-600">
          Highlight added to prompt
        </span>
        <p className="line-clamp-3 whitespace-pre-wrap text-amber-700 dark:text-amber-200">
          “{selection.text.trim()}”
        </p>
        <div className="flex flex-wrap gap-2 text-[10px] font-medium uppercase tracking-wide text-amber-500 dark:text-amber-300">
          {typeof selection.page === "number" && <span>Page {selection.page}</span>}
          {selection.section && <span>{selection.section}</span>}
        </div>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 transition hover:text-amber-700 dark:text-amber-300 dark:hover:text-amber-200"
        >
          Clear
        </button>
      )}
    </div>
  );
};

const ChatPanel = ({
  paperId,
  draft,
  onDraftChange,
  selection,
  onSelectionClear,
  onQuestionSent,
  onAnswerReceived,
  onError,
}: ChatPanelProps) => {
  const { isLoaded, isSignedIn } = useUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();

  const trimmedDraft = draft.trimStart();
  const commandSpaceIndex = trimmedDraft.indexOf(" ");
  const slashToken =
    trimmedDraft.startsWith("/") && commandSpaceIndex === -1
      ? trimmedDraft.slice(1)
      : trimmedDraft.startsWith("/")
        ? trimmedDraft.slice(1, commandSpaceIndex)
        : "";

  const showSlashMenu =
    trimmedDraft.startsWith("/") && commandSpaceIndex === -1 && !trimmedDraft.includes("\n");

  const filteredCommands = useMemo(() => {
    const query = slashToken.toLowerCase();
    if (!query) {
      return slashCommandDefinitions;
    }

    return slashCommandDefinitions.filter((definition) => {
      const id = definition.option.id.toLowerCase();
      const label = definition.option.label.toLowerCase();
      return id.startsWith(query) || label.includes(query);
    });
  }, [slashToken]);

  useEffect(() => {
    setSlashActiveIndex(0);
  }, [slashToken, showSlashMenu]);

  useEffect(() => {
    if (!scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<EditorIntentDetail>).detail;
      if (!detail?.text) {
        return;
      }

      const normalized = detail.text.trim();
      if (!normalized) {
        return;
      }

      let prompt: string;
      switch (detail.action) {
        case "go-deeper": {
          prompt = `Dig deeper on this passage. Include derivations or supporting evidence when relevant:\n“${normalized}”`;
          break;
        }
        case "condense": {
          prompt = `Condense this passage into a concise bullet:\n“${normalized}”`;
          break;
        }
        case "summarize-selection":
        default: {
          prompt = `Summarize the key insight from this excerpt:\n“${normalized}”`;
          break;
        }
      }

      onDraftChange(prompt);
      textareaRef.current?.focus();
    };

    window.addEventListener(EDITOR_INTENT_EVENT, handler);
    return () => window.removeEventListener(EDITOR_INTENT_EVENT, handler);
  }, [onDraftChange]);

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

      const messageId = createMessageId();
      const userMessage: ChatMessage = {
        id: messageId,
        role: "user",
        content: question,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage]);
      onQuestionSent?.(question);

      const payloadSelection = selectionOverride ?? selection;

      try {
        const response = await fetch("/api/qa", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paperId,
            question,
            selection: payloadSelection,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          const message = payload?.error ?? `QA request failed with status ${response.status}.`;
          throw new Error(message);
        }

        const result = (await response.json()) as AnswerResult;

        const assistantMessage: ChatMessage = {
          id: createMessageId(),
          role: "assistant",
          content: result.answer,
          createdAt: Date.now(),
          citations: result.cites,
          trust: result.trust,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        onAnswerReceived?.(result.answer);
        onDraftChange("");

        if (payloadSelection) {
          onSelectionClear?.();
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "Unexpected QA error occurred.";
        reportError(message);
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

  const handleSubmit = useCallback(
    (event?: React.FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      void sendQuestion(draft);
    },
    [draft, sendQuestion],
  );

  const applySlashCommand = useCallback(
    (definition: SlashCommandDefinition) => {
      const result = definition.buildQuestion({
        selection,
        draft,
      });
      onDraftChange(result.question);

      if (result.autoSubmit) {
        void sendQuestion(result.question, result.selection ?? selection);
      } else {
        textareaRef.current?.focus();
      }
    },
    [draft, onDraftChange, selection, sendQuestion],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashMenu && filteredCommands.length > 0) {
        if (event.key === "ArrowDown" || event.key === "Tab") {
          event.preventDefault();
          setSlashActiveIndex((prev) => (prev + 1 >= filteredCommands.length ? 0 : prev + 1));
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashActiveIndex((prev) => (prev - 1 < 0 ? filteredCommands.length - 1 : prev - 1));
          return;
        }

        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const definition = filteredCommands[slashActiveIndex] ?? filteredCommands[0];
          applySlashCommand(definition);
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          onDraftChange("");
          return;
        }
      }

      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!isSubmitting) {
          void sendQuestion(draft);
        }
      }
    },
    [
      applySlashCommand,
      draft,
      filteredCommands,
      isSubmitting,
      onDraftChange,
      sendQuestion,
      showSlashMenu,
      slashActiveIndex,
    ],
  );

  return (
    <div className="flex h-full flex-col gap-4 rounded-lg border border-zinc-200 bg-zinc-100/60 p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950/60">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Research Chat
          </h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Ask grounded questions about this paper.
          </p>
        </div>
      </div>

      {!isLoaded && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
          Loading chat...
        </div>
      )}

      {isLoaded && !isSignedIn && (
        <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
          <p className="mb-3">Sign in to use paper chat.</p>
          <div className="flex flex-wrap gap-2">
            <SignInButton>
              <button
                type="button"
                className="rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
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
              <div className="flex h-full items-center justify-center text-sm text-zinc-400 dark:text-zinc-500">
                Start by asking how the Transformer differs from attention-only baselines.
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} paperId={paperId} />
              ))
            )}
          </div>

          <SelectionCallout
            selection={selection}
            onClear={selection ? onSelectionClear : undefined}
          />

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}

          <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
            <label
              htmlFor={textareaId}
              className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
            >
              Ask a question
            </label>
            <div className="relative">
              <textarea
                ref={textareaRef}
                id={textareaId}
                value={draft}
                onChange={(event) => onDraftChange(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask how self-attention compares to recurrence…"
                disabled={isSubmitting}
                className="min-h-[96px] w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-800 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:opacity-60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-600 dark:focus:ring-zinc-800"
              />
              {showSlashMenu && filteredCommands.length > 0 && (
                <SlashCommandMenu
                  options={filteredCommands.map((definition) => definition.option)}
                  activeIndex={slashActiveIndex}
                  onSelect={(option) => {
                    const definition = filteredCommands.find(
                      (item) => item.option.id === option.id,
                    );
                    if (definition) {
                      applySlashCommand(definition);
                    }
                  }}
                  onHighlight={setSlashActiveIndex}
                />
              )}
            </div>
            <div className="flex items-center justify-end text-xs text-zinc-500 dark:text-zinc-400">
              <button
                type="submit"
                disabled={isSubmitting || !draft.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                {isSubmitting ? "Sending…" : "Send"}
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
};

export default ChatPanel;
