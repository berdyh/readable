"use client";

import { useState, useCallback, useMemo } from "react";
import {
  MessageSquare,
  X,
  FileText,
  Languages,
  Search,
  CheckCircle,
  Paperclip,
  Globe,
  ChevronUp,
  ChevronDown,
  Edit,
  Maximize2,
  Minimize2,
  Sparkles,
} from "lucide-react";
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
      className="fixed bottom-8 right-8 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg transition-all hover:bg-blue-700 hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-600"
      aria-label="Open AI chat"
    >
      <MessageSquare className="h-6 w-6" />
    </button>
  );
}

/**
 * Notion-style AI chat side panel
 * Design inspired by Notion's AI assistant interface
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
  const [input, setInput] = useState("");
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleQuestionSent = useCallback((question: string) => {
    console.log("Question sent:", question);
  }, []);

  const handleError = useCallback((error: string) => {
    console.error("Chat error:", error);
  }, []);

  const handleAnswerReceived = useCallback(
    (answer: string) => {
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
      setIsSubmitting(false);
      // Optionally insert answer as blocks
      if (onInsertBlocks && answer) {
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

  // Direct API call for sending questions (Notion-style UI)
  const sendQuestion = useCallback(
    async (question: string) => {
      if (!question.trim() || isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      setInput("");
      setChatDraft(question);

      // Add user message
      setMessages((prev) => [...prev, { role: "user", content: question }]);
      handleQuestionSent(question);

      try {
        const response = await fetch("/api/qa", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            paperId,
            question: question.trim(),
            userId: userId ?? "default",
            personaId: personaEnabled ? "demo" : undefined,
            selection,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          const message =
            payload?.error ?? `QA request failed with status ${response.status}.`;
          throw new Error(message);
        }

        const result = (await response.json()) as { answer: string };
        handleAnswerReceived(result.answer);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected QA error occurred.";
        handleError(message);
        setIsSubmitting(false);
      }
    },
    [
      isSubmitting,
      paperId,
      userId,
      personaEnabled,
      selection,
      handleQuestionSent,
      handleAnswerReceived,
      handleError,
    ],
  );

  // Quick action handlers
  const handleQuickAction = useCallback(
    (action: string) => {
      const prompts: Record<string, string> = {
        summarize: "Summarize this page",
        translate: "Translate this page to English",
        analyze: "Analyze this page for insights",
        task: "Create a task tracker based on this page",
      };

      const prompt = prompts[action] || action;
      setInput(prompt);
      // Auto-submit quick actions
      void sendQuestion(prompt);
    },
    [sendQuestion],
  );

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="fixed right-0 top-0 z-50 h-full flex flex-col"
      style={{
        width: "384px",
        backgroundColor: "#191919",
      }}
    >
      {/* Header - Notion-style */}
      <div
        className="flex items-center justify-between px-6 py-4"
        style={{
          borderBottom: "1px solid #2C2C2C",
        }}
      >
        <div className="flex items-center gap-2">
          <span
            style={{
              color: "#E5E5E5",
              fontSize: "16px",
              fontWeight: "500",
            }}
          >
            New AI chat
          </span>
          <ChevronDown size={18} style={{ color: "#9B9B9B" }} />
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="p-2 rounded transition-colors hover:bg-gray-800"
            style={{ color: "#9B9B9B" }}
            aria-label="Edit chat"
          >
            <Edit size={18} />
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(!isMinimized)}
            className="p-2 rounded transition-colors hover:bg-gray-800"
            style={{ color: "#9B9B9B" }}
            aria-label={isMinimized ? "Maximize" : "Minimize"}
          >
            {isMinimized ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
          </button>
          <button
            type="button"
            onClick={() => onToggle(false)}
            className="p-2 rounded transition-colors hover:bg-gray-800"
            style={{ color: "#9B9B9B" }}
            aria-label="Close chat"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Main Content Area - Notion-style welcome screen */}
          <div className="flex-1 flex items-center justify-center overflow-auto">
            <div
              className="w-full max-w-2xl mx-auto px-6"
              style={{ maxWidth: "680px" }}
            >
              <div className="flex flex-col">
                {/* AI Icon */}
                <div className="flex justify-start mb-8">
                  <div
                    className="w-20 h-20 rounded-full flex items-center justify-center text-4xl"
                    style={{ backgroundColor: "#E5E5E5" }}
                  >
                    <Sparkles className="h-10 w-10" style={{ color: "#191919" }} />
                  </div>
                </div>

                {/* Title */}
                <h1
                  className="text-4xl font-semibold mb-4"
                  style={{
                    color: "#FFFFFF",
                    fontSize: "32px",
                    lineHeight: "1.2",
                  }}
                >
                  Your improved Notion AI
                </h1>

                {/* Subtitle */}
                <p
                  className="mb-10"
                  style={{
                    color: "#9B9B9B",
                    fontSize: "16px",
                    lineHeight: "1.5",
                  }}
                >
                  Here are a few things I can do, or ask me anything!
                </p>

                {/* Quick Action Buttons */}
                <div className="space-y-2 mb-12">
                  {[
                    { icon: FileText, label: "Summarize this page", action: "summarize" },
                    { icon: Languages, label: "Translate this page", action: "translate" },
                    {
                      icon: Search,
                      label: "Analyze for insights",
                      action: "analyze",
                      badge: "New",
                    },
                    {
                      icon: CheckCircle,
                      label: "Create a task tracker",
                      action: "task",
                      badge: "New",
                    },
                  ].map(({ icon: Icon, label, action, badge }) => (
                    <button
                      key={action}
                      type="button"
                      onClick={() => handleQuickAction(action)}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors"
                      style={{
                        backgroundColor: "transparent",
                        color: "#E5E5E5",
                        border: "none",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = "#2C2C2C";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = "transparent";
                      }}
                    >
                      <Icon size={20} style={{ color: "#9B9B9B" }} />
                      <span style={{ fontSize: "15px" }}>{label}</span>
                      {badge && (
                        <span
                          className="ml-auto px-2 py-1 text-xs rounded"
                          style={{
                            backgroundColor: "#2E5C9A",
                            color: "#FFFFFF",
                            fontSize: "11px",
                            fontWeight: "500",
                          }}
                        >
                          {badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Input Section - Notion-style */}
                <div>
                  <div
                    className="rounded-xl overflow-hidden"
                    style={{
                      border: "2px solid #2E7DD6",
                      backgroundColor: "#2C2C2C",
                      boxShadow: "0 0 0 1px rgba(46, 125, 214, 0.2)",
                    }}
                  >
                    {/* Top buttons */}
                    <div
                      className="flex items-center gap-2 px-3 py-2"
                      style={{ borderBottom: "1px solid #3F3F3F" }}
                    >
                      <button
                        type="button"
                        className="flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors hover:bg-gray-700"
                        style={{
                          backgroundColor: "#3F3F3F",
                          color: "#9B9B9B",
                          border: "none",
                        }}
                      >
                        <span>@</span>
                      </button>
                      <button
                        type="button"
                        className="flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors hover:bg-gray-700"
                        style={{
                          backgroundColor: "#3F3F3F",
                          color: "#9B9B9B",
                          border: "none",
                        }}
                      >
                        <FileText size={14} />
                        <span style={{ fontSize: "13px" }}>New page</span>
                      </button>
                    </div>

                    {/* Input area */}
                    <div className="relative">
                      <input
                        type="text"
                        value={input}
                        onChange={(e) => {
                          setInput(e.target.value);
                          setChatDraft(e.target.value);
                        }}
                        placeholder="Ask, search, or make anything..."
                        className="w-full bg-transparent outline-none"
                        style={{
                          color: "#E5E5E5",
                          padding: "16px 16px",
                          fontSize: "15px",
                          border: "none",
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && input.trim() && !isSubmitting) {
                            e.preventDefault();
                            void sendQuestion(input);
                          }
                        }}
                      />
                    </div>

                    {/* Bottom toolbar */}
                    <div
                      className="flex items-center justify-between px-4 py-2"
                      style={{ borderTop: "1px solid #3F3F3F" }}
                    >
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          style={{ color: "#9B9B9B" }}
                          className="hover:text-gray-300"
                        >
                          <Paperclip size={18} />
                        </button>
                        <span style={{ color: "#9B9B9B", fontSize: "13px" }}>
                          Auto
                        </span>
                        <button
                          type="button"
                          className="flex items-center gap-2 hover:text-gray-300"
                          style={{ color: "#9B9B9B" }}
                        >
                          <Globe size={16} />
                          <span style={{ fontSize: "13px" }}>All sources</span>
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (input.trim() && !isSubmitting) {
                            void sendQuestion(input);
                          }
                        }}
                        disabled={!input.trim() || isSubmitting}
                        className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ backgroundColor: "#3F3F3F" }}
                      >
                        <ChevronUp size={18} style={{ color: "#9B9B9B" }} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Display chat messages if any */}
          {messages.length > 0 && (
            <div
              className="flex-1 overflow-y-auto px-6 py-4"
              style={{ borderTop: "1px solid #2C2C2C" }}
            >
              <div className="space-y-4">
                {messages.map((message, index) => (
                  <div key={index} className="flex flex-col gap-2">
                    <div
                      className="rounded-lg p-3 text-sm"
                      style={{
                        backgroundColor:
                          message.role === "user" ? "#2C2C2C" : "#3F3F3F",
                        color: "#E5E5E5",
                      }}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
                {isSubmitting && (
                  <div
                    className="rounded-lg p-3 text-sm text-gray-400"
                    style={{ backgroundColor: "#2C2C2C" }}
                  >
                    Thinking...
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
