"use client";

import { useState, useCallback } from "react";
import { MessageSquare, X } from "lucide-react";
import ChatPanel from "../chat/ChatPanel";
import type { Block } from "./types";
import type { QuestionSelection } from "@/server/qa/types";

interface ChatIntegrationProps {
  paperId: string;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  onInsertBlocks?: (blocks: Block[]) => void;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
  personaEnabled?: boolean;
  onPersonaToggle?: (enabled: boolean) => void;
  userId?: string;
}

/**
 * Floating AI chat button that opens chat panel
 */
export function ChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-8 right-8 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-600"
      aria-label="Open AI chat"
    >
      <MessageSquare className="h-6 w-6" />
    </button>
  );
}

/**
 * Right-side chat panel component
 */
export function ChatSidePanel({
  paperId,
  isOpen,
  onToggle,
  onInsertBlocks,
  selection,
  onSelectionClear,
  personaEnabled = false,
  onPersonaToggle,
  userId,
}: ChatIntegrationProps) {
  const [chatDraft, setChatDraft] = useState("");

  const handleAnswerReceived = useCallback(
    (answer: string) => {
      // Optionally insert answer as blocks
      if (onInsertBlocks && answer) {
        // Parse answer into blocks (can be improved)
        const blocks: Block[] = [
          {
            id: `chat-${Date.now()}`,
            type: "callout",
            content: answer,
            metadata: {
              type: "info",
            },
          },
        ];
        onInsertBlocks(blocks);
      }
    },
    [onInsertBlocks],
  );

  const handleQuestionSent = useCallback((question: string) => {
    // Can be used for tracking/logging
    console.log("Question sent:", question);
  }, []);

  const handleError = useCallback((error: string) => {
    console.error("Chat error:", error);
  }, []);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed right-0 top-0 z-50 h-full w-96 border-l border-neutral-200 bg-white shadow-xl dark:border-neutral-700 dark:bg-neutral-900">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-700">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300">
            AI Chat
          </h2>
          <button
            type="button"
            onClick={() => onToggle(false)}
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label="Close chat"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Chat Panel */}
        <div className="flex-1 overflow-hidden">
          <ChatPanel
            paperId={paperId}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            selection={selection}
            onSelectionClear={onSelectionClear}
            personaEnabled={personaEnabled}
            onPersonaToggle={onPersonaToggle || (() => {})}
            userId={userId}
            onQuestionSent={handleQuestionSent}
            onAnswerReceived={handleAnswerReceived}
            onError={handleError}
          />
        </div>
      </div>
    </div>
  );
}

