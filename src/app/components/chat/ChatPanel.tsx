"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AnswerResult, QuestionSelection } from "@/server/qa/types";

import SlashCommandMenu, {
  type SlashCommandOption,
} from "./SlashCommandMenu";

type MessageRole = "user" | "assistant";

interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: number;
  citations?: AnswerResult["cites"];
}

export interface ChatPanelProps {
  paperId: string;
  draft: string;
  onDraftChange: (value: string) => void;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
  personaEnabled: boolean;
  onPersonaToggle: (enabled: boolean) => void;
  userId?: string;
  onQuestionSent?: (question: string) => void;
  onAnswerReceived?: (answer: string) => void;
  onError?: (error: string) => void;
}

interface SlashCommandDefinition {
  option: SlashCommandOption;
  buildQuestion: (context: {
    selection?: QuestionSelection;
    personaEnabled: boolean;
    draft: string;
  }) => {
    question: string;
    selection?: QuestionSelection;
    autoSubmit?: boolean;
  };
}

const DEFAULT_USER_ID =
  process.env.NEXT_PUBLIC_KONTEXT_DEMO_USER_ID ?? "demo-user";

const DemoPersonaId = "demo-researcher";

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
        question:
          "Explain the Transformer architecture introduced in this paper.",
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
        question:
          "Explain the Transformer paper like I’m five, sticking to grounded facts.",
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

const PersonaToggle = ({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: (next: boolean) => void;
}) => {
  return (
    <button
      type="button"
      onClick={() => onToggle(!enabled)}
      className="inline-flex items-center gap-2 rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
    >
      <span
        className={`flex h-2.5 w-2.5 items-center justify-center rounded-full ${enabled ? "bg-emerald-500" : "bg-zinc-300"}`}
      />
      Persona {enabled ? "on" : "off"}
    </button>
  );
};

const MessageBubble = ({ message }: { message: ChatMessage }) => {
  const isUser = message.role === "user";

  return (
    <div
      className={`flex flex-col gap-3 rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm ${isUser ? "self-end bg-zinc-900 text-white" : "self-start bg-white text-zinc-800"}`}
    >
      <div className="whitespace-pre-wrap">{message.content}</div>
      {!isUser && message.citations?.length ? (
        <div className="flex flex-wrap gap-2">
          {message.citations.map((cite) => (
            <span
              key={`${cite.chunkId}-${cite.page ?? "?"}`}
              className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700"
            >
              {cite.page ? `p.${cite.page}` : "p.?"}
              <span className="text-[10px] uppercase tracking-wide text-blue-500">
                {cite.chunkId}
              </span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
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
    <div className="flex items-start justify-between gap-4 rounded-lg border border-amber-200 bg-amber-50/80 p-3 text-xs text-amber-700">
      <div className="flex flex-col gap-1">
        <span className="font-semibold uppercase tracking-wide text-amber-600">
          Highlight added to prompt
        </span>
        <p className="line-clamp-3 whitespace-pre-wrap text-amber-700">
          “{selection.text.trim()}”
        </p>
        <div className="flex flex-wrap gap-2 text-[10px] font-medium uppercase tracking-wide text-amber-500">
          {typeof selection.page === "number" && (
            <span>Page {selection.page}</span>
          )}
          {selection.section && <span>{selection.section}</span>}
        </div>
      </div>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] font-semibold uppercase tracking-wide text-amber-600 transition hover:text-amber-700"
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
  personaEnabled,
  onPersonaToggle,
  userId,
  onQuestionSent,
  onAnswerReceived,
  onError,
}: ChatPanelProps) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [slashActiveIndex, setSlashActiveIndex] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaId = useId();

  const personaLabel = useMemo(
    () => (personaEnabled ? "Persona tuning enabled" : "Persona tuning off"),
    [personaEnabled],
  );

  const trimmedDraft = draft.trimStart();
  const commandSpaceIndex = trimmedDraft.indexOf(" ");
  const slashToken =
    trimmedDraft.startsWith("/") && commandSpaceIndex === -1
      ? trimmedDraft.slice(1)
      : trimmedDraft.startsWith("/")
        ? trimmedDraft.slice(1, commandSpaceIndex)
        : "";

  const showSlashMenu =
    trimmedDraft.startsWith("/") &&
    commandSpaceIndex === -1 &&
    !trimmedDraft.includes("\n");

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
            userId: userId ?? DEFAULT_USER_ID,
            personaId: personaEnabled ? DemoPersonaId : undefined,
            selection: payloadSelection,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          const message =
            payload?.error ??
            `QA request failed with status ${response.status}.`;
          throw new Error(message);
        }

        const result = (await response.json()) as AnswerResult;

        const assistantMessage: ChatMessage = {
          id: createMessageId(),
          role: "assistant",
          content: result.answer,
          createdAt: Date.now(),
          citations: result.cites,
        };

        setMessages((prev) => [...prev, assistantMessage]);
        onAnswerReceived?.(result.answer);
        onDraftChange("");

        if (payloadSelection) {
          onSelectionClear?.();
        }
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Unexpected QA error occurred.";
        reportError(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      onAnswerReceived,
      onDraftChange,
      onQuestionSent,
      onSelectionClear,
      paperId,
      personaEnabled,
      reportError,
      selection,
      userId,
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
        personaEnabled,
        draft,
      });
      onDraftChange(result.question);

      if (result.autoSubmit) {
        void sendQuestion(result.question, result.selection ?? selection);
      } else {
        textareaRef.current?.focus();
      }
    },
    [draft, onDraftChange, personaEnabled, selection, sendQuestion],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (showSlashMenu && filteredCommands.length > 0) {
        if (event.key === "ArrowDown" || event.key === "Tab") {
          event.preventDefault();
          setSlashActiveIndex((prev) =>
            prev + 1 >= filteredCommands.length ? 0 : prev + 1,
          );
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          setSlashActiveIndex((prev) =>
            prev - 1 < 0 ? filteredCommands.length - 1 : prev - 1,
          );
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
    <div className="flex h-full flex-col gap-4 rounded-xl border border-zinc-200 bg-zinc-100/60 p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Research Chat
          </h2>
          <p className="text-xs text-zinc-500">
            Ask grounded questions about this paper.
          </p>
        </div>
        <PersonaToggle enabled={personaEnabled} onToggle={onPersonaToggle} />
      </div>

      <div
        ref={scrollRef}
        className="flex min-h-[220px] flex-1 flex-col gap-3 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-4"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-400">
            Start by asking how the Transformer differs from attention-only
            baselines.
          </div>
        ) : (
          messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))
        )}
      </div>

      <SelectionCallout
        selection={selection}
        onClear={selection ? onSelectionClear : undefined}
      />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-600">
          {error}
        </div>
      )}

      <form className="flex flex-col gap-3" onSubmit={handleSubmit}>
        <label
          htmlFor={textareaId}
          className="text-xs font-semibold uppercase tracking-wide text-zinc-500"
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
            placeholder={
              personaEnabled
                ? "e.g., /eli5 what the self-attention block is doing"
                : "Ask how self-attention compares to recurrence…"
            }
            className="min-h-[96px] w-full resize-y rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-800 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
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
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span>{personaLabel}</span>
          <button
            type="submit"
            disabled={isSubmitting || !draft.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChatPanel;
