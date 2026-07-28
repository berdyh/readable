"use client";

import { Loader2, Sparkles } from "lucide-react";

import { AnswerCard } from "../primitives/answer-card";
import { Conversation, ConversationContent } from "../primitives/conversation";
import { Message, MessageAvatar } from "../primitives/message";
import { QUICK_PROMPTS } from "../model/prompts";
import type { ChatMessage } from "../model/types";

function ChatMessageRow({ message, paperId }: { message: ChatMessage; paperId: string }) {
  if (message.role === "user") {
    return (
      <Message from="user" className="items-start">
        <div className="max-w-[86%] whitespace-pre-wrap break-words rounded-lg bg-zinc-200/70 px-3 py-2 text-sm leading-relaxed text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
          {message.content}
        </div>
      </Message>
    );
  }

  return (
    <Message from="assistant" className="items-start">
      <MessageAvatar from="assistant" />
      <AnswerCard
        className="max-w-[86%]"
        content={message.content}
        citations={message.citations}
        trust={message.trust}
        reasoning={message.reasoning}
        paperId={paperId}
        status={message.status}
      />
    </Message>
  );
}

function ChatEmptyState({ onPrompt }: { onPrompt: (prompt: string) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="flex w-full max-w-sm flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
          <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          Start a paper chat
        </div>
        <div className="grid gap-2">
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => onPrompt(prompt)}
              className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-700 transition-colors duration-150 hover:border-emerald-400 hover:bg-emerald-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-600 dark:hover:bg-emerald-950/30 dark:hover:text-zinc-50"
            >
              {prompt}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatTranscript({
  messages,
  paperId,
  isSubmitting,
  onPrompt,
}: {
  messages: ChatMessage[];
  paperId: string;
  isSubmitting: boolean;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-4">
        {messages.length === 0 ? (
          <ChatEmptyState onPrompt={onPrompt} />
        ) : (
          messages.map((message) => (
            <ChatMessageRow key={message.id} message={message} paperId={paperId} />
          ))
        )}

        {isSubmitting && (
          <Message from="assistant" className="items-start">
            <MessageAvatar from="assistant" />
            <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Thinking…
            </div>
          </Message>
        )}
      </ConversationContent>
    </Conversation>
  );
}
