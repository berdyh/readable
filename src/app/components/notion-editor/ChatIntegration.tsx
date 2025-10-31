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
 * Inspired by Notion's circular AI assistant button
 */
export function ChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-6 right-6 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-black text-white shadow-2xl transition-all hover:scale-110 hover:shadow-3xl focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      aria-label="Open AI chat"
      title="AI Chat"
    >
      <MessageSquare className="h-5 w-5" />
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
    <div className="fixed right-0 top-0 z-50 h-full w-[380px] border-l border-neutral-200/80 bg-white shadow-2xl dark:border-neutral-800 dark:bg-neutral-950">
      <div className="flex h-full flex-col">
        {/* Header - Notion-style clean header */}
        <div className="flex items-center justify-between border-b border-neutral-200/60 px-5 py-3.5 dark:border-neutral-800">
          <h2 className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            AI Assistant
          </h2>
          <button
            type="button"
            onClick={() => onToggle(false)}
            className="flex h-7 w-7 items-center justify-center rounded text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Chat Panel */}
        <div className="flex-1 overflow-hidden bg-neutral-50/30 dark:bg-neutral-900/50">
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

