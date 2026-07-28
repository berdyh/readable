"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { MessageSquare, Send, X } from "lucide-react";
import { clsx } from "clsx";
import type { Block } from "../types";
import { InlineChatPanel } from "../../chat";

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
  // Use ref to track latest content to avoid stale closures
  const contentRef = useRef(block.content);

  // Update ref whenever block.content changes
  useEffect(() => {
    contentRef.current = block.content;
  }, [block.content]);

  // Parse chat history from block content
  // Format: messages separated by "---" lines
  const messages = block.content
    ? block.content.split(/---+\n/).filter(Boolean)
    : [];

  const handleAnswerReceived = useCallback(
    (answer: string) => {
      // Use ref to get the latest content, avoiding stale closure issues
      const currentContent = contentRef.current || "";
      const newContent =
        currentContent && !currentContent.endsWith("\n")
          ? `${currentContent}\n---\n${answer}`
          : `${currentContent}---\n${answer}`;

      // Update both the ref immediately and trigger state update
      contentRef.current = newContent;
      onUpdate(newContent);

      // Optionally create separate blocks for the answer
      if (onInsertBlocks) {
        // This is handled by the content update above
        // Could also parse and create structured blocks if needed
      }
    },
    [onUpdate, onInsertBlocks],
  );

  const handleQuestionSent = useCallback((question: string) => {
    // Use ref to get the latest content, avoiding stale closure issues
    // This ensures rapid sequential questions don't overwrite each other
    const currentContent = contentRef.current || "";
    const questionLine = `Q: ${question}`;
    const newContent = currentContent
      ? `${currentContent}\n${questionLine}\n---\n`
      : `${questionLine}\n---\n`;

    // Update both the ref immediately (for next question) and trigger state update
    contentRef.current = newContent;
    onUpdate(newContent);
    setChatDraft(""); // Clear draft after sending
  }, [onUpdate]);

  const handleError = useCallback((error: string) => {
    console.error("Chat error:", error);
    // Could append error to content as well
  }, []);

  // If collapsed, show summary
  if (!isExpanded) {
    return (
      <div className="my-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-zinc-500" />
            <span className="text-sm text-zinc-600 dark:text-zinc-400">
              Chat Assistant {messages.length > 0 && `(${messages.length} messages)`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsExpanded(true)}
              className="rounded px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700"
            >
              Expand
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded p-1 text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
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
    <div className="my-4 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2 dark:border-zinc-600">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-zinc-500" />
          <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Inline Chat
          </span>
        </div>
        <button
          type="button"
          onClick={() => setIsExpanded(false)}
          className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Collapse chat"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Chat Messages (existing content) */}
      {messages.length > 0 && (
        <div className="border-b border-zinc-200 dark:border-zinc-600">
          <div className="max-h-[300px] space-y-0 overflow-y-auto px-4 py-3">
            {messages.map((message, index) => (
              <div key={index}>
                <div
                  className={clsx(
                    "whitespace-pre-wrap rounded p-2 text-sm",
                    message.trim().startsWith("Q:")
                      ? "bg-blue-50 text-blue-900 dark:bg-blue-950/20 dark:text-blue-200"
                      : "bg-white text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100",
                  )}
                >
                  {message.trim()}
                </div>
                {index < messages.length - 1 && (
                  <div className="my-2 border-t border-zinc-200 dark:border-zinc-600" />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Embedded chat */}
      <div className="p-2">
        {paperId ? (
          <InlineChatPanel
            paperId={paperId}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            onQuestionSent={handleQuestionSent}
            onAnswerReceived={handleAnswerReceived}
            onError={handleError}
          />
        ) : (
          <div className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900">
            Chat requires paper ID
          </div>
        )}
      </div>
    </div>
  );
}

