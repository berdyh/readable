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
  onInsertBlocks?: (blocks: Block[], insertIndex?: number) => void;
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
    // Use question parameter directly - it's the fresh value passed to this callback
    // Note: block.content might be stale in the closure, but the question parameter is always fresh
    const questionLine = `Q: ${question}`;
    
    // Read current content from block prop (will be fresh on each render due to dependency)
    const currentContent = block.content || "";
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

  // If collapsed, show summary
  if (!isExpanded) {
    return (
      <div className="my-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-neutral-500" />
            <span className="text-sm text-neutral-600 dark:text-neutral-400">
              Chat Assistant {messages.length > 0 && `(${messages.length} messages)`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="rounded px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-200 dark:text-neutral-400 dark:hover:bg-neutral-700"
            >
              Expand
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded p-1 text-neutral-400 hover:text-red-600 dark:hover:text-red-400"
                aria-label="Delete chat block"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Expanded view with full chat interface
  return (
    <div className="my-4 rounded-lg border border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-2 dark:border-neutral-600">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-neutral-500" />
          <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Inline Chat
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          className="rounded p-1 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
          aria-label="Collapse chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Chat Messages (existing content) */}
      {messages.length > 0 && (
        <div className="border-b border-neutral-200 dark:border-neutral-600">
          <div className="max-h-[300px] space-y-0 overflow-y-auto px-4 py-3">
            {messages.map((message, index) => (
              <div key={index}>
                <div
                  className={clsx(
                    "whitespace-pre-wrap rounded p-2 text-sm",
                    message.trim().startsWith("Q:")
                      ? "bg-blue-50 text-blue-900 dark:bg-blue-950/20 dark:text-blue-200"
                      : "bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-100",
                  )}
                >
                  {message.trim()}
                </div>
                {index < messages.length - 1 && (
                  <div className="my-2 border-t border-neutral-200 dark:border-neutral-600" />
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

