"use client";

import { useState, useCallback } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { clsx } from "clsx";
import type { Block } from "../types";
import ChatPanel from "../../chat/ChatPanel";

interface ChatMessageBlockProps {
  block: Block;
  onUpdate: (content: string) => void;
  onEnter?: () => void;
  onBackspace?: () => void;
  paperId?: string;
  onInsertBlocks?: (blocks: Block[]) => void;
  onDelete?: () => void;
}

/**
 * Inline chat message block - displays chat interface within the editor
 * Outputs are written in boxes separated by simple lines
 */
export function ChatMessageBlock({
  block,
  onUpdate,
  paperId,
  onInsertBlocks,
  onDelete,
}: ChatMessageBlockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [chatDraft, setChatDraft] = useState("");

  // Parse chat history from block content
  // Format: messages separated by "---" lines
  const messages = block.content
    ? block.content.split(/---+\n/).filter(Boolean)
    : [];

  const handleAnswerReceived = useCallback(
    (answer: string) => {
      // Append answer to block content, separated by a line
      const currentContent = block.content || "";
      const newContent =
        currentContent && !currentContent.endsWith("\n")
          ? `${currentContent}\n---\n${answer}`
          : `${currentContent}---\n${answer}`;

      onUpdate(newContent);

      // Optionally create separate blocks for the answer
      if (onInsertBlocks) {
        // This is handled by the content update above
        // Could also parse and create structured blocks if needed
      }
    },
    [block.content, onUpdate, onInsertBlocks],
  );

  const handleQuestionSent = useCallback((question: string) => {
    // Prepend question to block content
    const currentContent = block.content || "";
    const questionLine = `Q: ${question}`;
    const newContent = currentContent
      ? `${currentContent}\n${questionLine}\n---\n`
      : `${questionLine}\n---\n`;

    onUpdate(newContent);
    setChatDraft(""); // Clear draft after sending
  }, [block.content, onUpdate]);

  const handleError = useCallback((error: string) => {
    console.error("Chat error:", error);
    // Could append error to content as well
  }, []);

  // If collapsed, show summary - Notion-style compact view
  if (!isExpanded) {
    return (
      <div className="group relative my-1.5 rounded-md border border-neutral-200/60 bg-neutral-50/50 px-3 py-2.5 transition-colors hover:bg-neutral-100/80 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:bg-neutral-800/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded bg-neutral-200 dark:bg-neutral-700">
              <MessageSquare className="h-3.5 w-3.5 text-neutral-600 dark:text-neutral-300" />
            </div>
            <span className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
              AI Chat {messages.length > 0 && <span className="text-xs text-neutral-500 dark:text-neutral-400">({messages.length})</span>}
            </span>
          </div>
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="rounded px-2 py-1 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-200 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            >
              Open
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="flex h-6 w-6 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-200 hover:text-red-600 dark:hover:bg-neutral-700 dark:hover:text-red-400"
                aria-label="Delete chat block"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Expanded view with full chat interface - Notion-style design
  return (
    <div className="my-3 rounded-lg border border-neutral-200/80 bg-white shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      {/* Header - Notion-style clean header */}
      <div className="flex items-center justify-between border-b border-neutral-200/60 px-4 py-3 dark:border-neutral-800">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded bg-neutral-100 dark:bg-neutral-800">
            <MessageSquare className="h-4 w-4 text-neutral-600 dark:text-neutral-300" />
          </div>
          <span className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            AI Assistant
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          className="flex h-7 w-7 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Collapse chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Chat Messages (existing content) - Notion-style message display */}
      {messages.length > 0 && (
        <div className="border-b border-neutral-200/60 dark:border-neutral-800">
          <div className="max-h-[320px] space-y-0 overflow-y-auto px-4 py-3">
            {messages.map((message, index) => (
              <div key={index}>
                <div
                  className={clsx(
                    "whitespace-pre-wrap rounded-md p-3 text-sm leading-relaxed",
                    message.trim().startsWith("Q:")
                      ? "bg-blue-50/80 text-blue-900 dark:bg-blue-950/30 dark:text-blue-100"
                      : "bg-neutral-50/50 text-neutral-900 dark:bg-neutral-900/50 dark:text-neutral-100",
                  )}
                >
                  {message.trim()}
                </div>
                {index < messages.length - 1 && (
                  <div className="my-2 h-px bg-neutral-200/60 dark:bg-neutral-800" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Embedded ChatPanel */}
      <div className="p-2">
        {paperId ? (
          <ChatPanel
            paperId={paperId}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            personaEnabled={false}
            onPersonaToggle={() => {}}
            onQuestionSent={handleQuestionSent}
            onAnswerReceived={handleAnswerReceived}
            onError={handleError}
          />
        ) : (
          <div className="rounded border border-neutral-200 bg-white p-4 text-sm text-neutral-500 dark:border-neutral-600 dark:bg-neutral-900">
            Chat requires paper ID
          </div>
        )}
      </div>
    </div>
  );
}

