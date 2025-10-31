"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useTheme } from "next-themes";
import {
  MessageSquare,
  X,
  Plus,
  Upload,
} from "lucide-react";
import { clsx } from "clsx";
import type { Block } from "./types";
import type { QuestionSelection } from "@/server/qa/types";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "../ai-chatbot/conversation";
import { Message, MessageAvatar, MessageContent } from "../ai-chatbot/message";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "../ai-chatbot/prompt-input";
import { Reasoning, ReasoningContent } from "../ai-chatbot/reasoning";
import { Sources, SourcesContent } from "../ai-chatbot/sources";

interface ChatIntegrationProps {
  paperId: string;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  onInsertBlocks?: (blocks: Block[], insertIndex?: number) => void;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
  personaEnabled?: boolean;
  onPersonaToggle?: (enabled: boolean) => void;
  userId?: string;
}

interface ChatTab {
  id: string;
  title: string;
  messages: ChatMessage[];
  sessionId: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Array<{ id: string; title: string; url?: string; page?: number }>;
  reasoning?: string;
  createdAt: number;
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
 * Block editor AI chat side panel with tabs
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
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [tabs, setTabs] = useState<ChatTab[]>([
    {
      id: `chat-${Date.now()}`,
      title: "New AI chat",
      messages: [],
      sessionId: null,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string | null>(tabs[0]?.id || null);
  const [input, setInput] = useState("");
  const [mentionQuery, setMentionQuery] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const mentionMenuRef = useRef<HTMLDivElement>(null);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Load chat history for paper on mount
  useEffect(() => {
    if (!isOpen || !paperId || !mounted) {
      return;
    }

    const loadChatHistory = async () => {
      try {
        setIsLoadingHistory(true);
        const response = await fetch(
          `/api/chat/history?paperId=${encodeURIComponent(paperId)}&userId=${encodeURIComponent(userId ?? "default")}`,
        );

        if (!response.ok) {
          console.error("Failed to load chat history");
          setIsLoadingHistory(false);
          return;
        }

        const result = (await response.json()) as {
          sessions?: Array<{
            sessionId: string;
            messages: ChatMessage[];
            createdAt: number;
            updatedAt: number;
          }>;
        };

        if (result.sessions && result.sessions.length > 0) {
          // Load existing sessions as tabs
          const loadedTabs: ChatTab[] = result.sessions.map((session, index) => ({
            id: `chat-${session.sessionId}`,
            title: index === 0 ? "New AI chat" : `Chat ${index + 1}`,
            messages: session.messages,
            sessionId: session.sessionId,
          }));

          setTabs(loadedTabs);
          setActiveTabId(loadedTabs[0]?.id || null);
        } else {
          // No history, create default tab
          const defaultTab: ChatTab = {
            id: `chat-${Date.now()}`,
            title: "New AI chat",
            messages: [],
            sessionId: null,
          };
          setTabs([defaultTab]);
          setActiveTabId(defaultTab.id);
        }
      } catch (error) {
        console.error("Error loading chat history:", error);
        // Fallback to default tab
        const defaultTab: ChatTab = {
          id: `chat-${Date.now()}`,
          title: "New AI chat",
          messages: [],
          sessionId: null,
        };
        setTabs([defaultTab]);
        setActiveTabId(defaultTab.id);
      } finally {
        setIsLoadingHistory(false);
      }
    };

    void loadChatHistory();
  }, [isOpen, paperId, userId, mounted]);

  const isDarkMode = mounted && resolvedTheme === "dark";
  const activeTab = tabs.find((tab) => tab.id === activeTabId);

  // Create new chat tab
  const handleNewChat = useCallback(async () => {
    try {
      const response = await fetch("/api/chat/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId,
          userId: userId ?? "default",
        }),
      });

      let sessionId: string | null = null;
      if (response.ok) {
        const result = (await response.json()) as { session: { id: string } };
        sessionId = result.session.id;
      }

      // Load messages for this session if sessionId exists
      let initialMessages: ChatMessage[] = [];
      if (sessionId) {
        try {
          const historyResponse = await fetch(
            `/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`,
          );
          if (historyResponse.ok) {
            const historyResult = (await historyResponse.json()) as {
              messages?: ChatMessage[];
            };
            initialMessages = historyResult.messages || [];
          }
        } catch (error) {
          console.error("Failed to load session history:", error);
        }
      }

      const newTab: ChatTab = {
        id: `chat-${Date.now()}`,
        title: `Chat ${tabs.length + 1}`,
        messages: initialMessages,
        sessionId,
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setInput("");
    } catch (error) {
      console.error("Failed to create new chat session:", error);
      // Still create tab even if backend fails
      const newTab: ChatTab = {
        id: `chat-${Date.now()}`,
        title: `Chat ${tabs.length + 1}`,
        messages: [],
        sessionId: null,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setInput("");
    }
  }, [paperId, userId, tabs.length]);

  // Handle @ mention for context
  const handleMentionTrigger = useCallback((query: string) => {
    setMentionQuery(query);
    // TODO: Fetch context suggestions from backend
    // This could be papers, sections, figures, etc.
  }, []);

  // Handle ingest to highlighted block
  const handleIngestToBlock = useCallback(() => {
    if (!activeTab || !onInsertBlocks) {
      return;
    }

    // Get the last assistant message
    const lastMessage = [...activeTab.messages]
      .reverse()
      .find((msg) => msg.role === "assistant");
    
    if (!lastMessage) {
      return;
    }

    // Insert as a paragraph block
    const blocks: Block[] = [
      {
        id: `ingest-${Date.now()}`,
        type: "paragraph",
        content: lastMessage.content,
      },
    ];

    onInsertBlocks(blocks);
  }, [activeTab, onInsertBlocks]);

  // Send question to backend
  const sendQuestion = useCallback(
    async (question: string) => {
      if (!question.trim() || !activeTab || isSubmitting) {
        return;
      }

      setIsSubmitting(true);
      const userMessageId = `msg-${Date.now()}`;
      
      // Add user message
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content: question.trim(),
        createdAt: Date.now(),
      };

      setTabs((prev) =>
        prev.map((tab) =>
          tab.id === activeTabId
            ? { ...tab, messages: [...tab.messages, userMessage] }
            : tab,
        ),
      );

      // Save user message to history
      if (activeTab?.sessionId) {
        try {
          await fetch("/api/chat/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: activeTab.sessionId,
              paperId,
              userId: userId ?? "default",
              message: userMessage,
            }),
          });
        } catch (error) {
          console.error("Failed to save user message:", error);
        }
      }

      setInput("");

      try {
        const response = await fetch("/api/qa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId,
            question: question.trim(),
            userId: userId ?? "default",
            personaId: personaEnabled ? "demo" : undefined,
            selection: mentionQuery ? { text: mentionQuery } : selection,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          const message = payload?.error ?? `QA request failed with status ${response.status}.`;
          throw new Error(message);
        }

        const result = (await response.json()) as {
          answer: string;
          cites?: Array<{ id: string; title: string; url?: string; page?: number }>;
        };

        // Add assistant message with citations
        const assistantMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: result.answer,
          citations: result.cites,
          createdAt: Date.now(),
        };

        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabId
              ? { ...tab, messages: [...tab.messages, assistantMessage] }
              : tab,
          ),
        );

        // Save assistant message to history
        if (activeTab?.sessionId) {
          try {
            await fetch("/api/chat/history", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: activeTab.sessionId,
                paperId,
                userId: userId ?? "default",
                message: assistantMessage,
              }),
            });
          } catch (error) {
            console.error("Failed to save assistant message:", error);
          }
        }

        // Optionally insert as blocks
        if (onInsertBlocks && result.answer) {
          const blocks: Block[] = [
            {
              id: `chat-${Date.now()}`,
              type: "callout",
              content: result.answer,
              metadata: { type: "info" },
            },
          ];
          onInsertBlocks(blocks);
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unexpected QA error occurred.";
        const errorMessage: ChatMessage = {
          id: `msg-${Date.now()}`,
          role: "assistant",
          content: `Error: ${message}`,
          createdAt: Date.now(),
        };
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTabId
              ? { ...tab, messages: [...tab.messages, errorMessage] }
              : tab,
          ),
        );

        // Save error message to history
        if (activeTab?.sessionId) {
          try {
            await fetch("/api/chat/history", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                sessionId: activeTab.sessionId,
                paperId,
                userId: userId ?? "default",
                message: errorMessage,
              }),
            });
          } catch (error) {
            console.error("Failed to save error message:", error);
          }
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeTab,
      activeTabId,
      isSubmitting,
      paperId,
      userId,
      personaEnabled,
      selection,
      mentionQuery,
      onInsertBlocks,
    ],
  );

  // Handle submit
  const handleSubmit = useCallback(
    (value: string) => {
      void sendQuestion(value);
    },
    [sendQuestion],
  );

  // Close tab
  const handleCloseTab = useCallback(
    (tabId: string) => {
      if (tabs.length <= 1) {
        // If last tab, just clear messages
        setTabs([
          {
            id: `chat-${Date.now()}`,
            title: "New AI chat",
            messages: [],
            sessionId: null,
          },
        ]);
        setActiveTabId(tabs[0]?.id || null);
      } else {
        setTabs((prev) => prev.filter((tab) => tab.id !== tabId));
        if (activeTabId === tabId) {
          const remainingTabs = tabs.filter((tab) => tab.id !== tabId);
          setActiveTabId(remainingTabs[0]?.id || null);
        }
      }
    },
    [tabs, activeTabId],
  );

  if (!isOpen || !mounted) {
    return null;
  }

  // Show loading state while fetching history
  if (isLoadingHistory) {
    return (
      <div
        className={clsx(
          "fixed right-0 top-0 z-40 flex h-full w-[420px] flex-col shadow-xl transition-transform",
          isDarkMode ? "bg-neutral-900" : "bg-white",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex h-full items-center justify-center">
          <div className="text-sm text-neutral-500 dark:text-neutral-400">
            Loading chat history...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={clsx(
        "fixed right-0 top-0 z-50 h-full flex flex-col border-l",
        isDarkMode
          ? "bg-neutral-900 border-neutral-800"
          : "bg-white border-neutral-200",
      )}
      style={{ width: "420px" }}
    >
      {/* Header with tabs */}
      <div
        className={clsx(
          "flex flex-col border-b",
          isDarkMode ? "border-neutral-800" : "border-neutral-200",
        )}
      >
        {/* Tab bar */}
        <div className="flex items-center gap-1 px-2 pt-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTabId(tab.id)}
              className={clsx(
                "flex items-center gap-2 px-3 py-2 rounded-t-lg text-sm transition-colors relative group",
                activeTabId === tab.id
                  ? isDarkMode
                    ? "bg-neutral-800 text-neutral-100"
                    : "bg-neutral-50 text-neutral-900"
                  : isDarkMode
                    ? "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                    : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-50",
              )}
            >
              <span className="whitespace-nowrap">{tab.title}</span>
              {tabs.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCloseTab(tab.id);
                  }}
                  className={clsx(
                    "opacity-0 group-hover:opacity-100 transition-opacity rounded p-0.5",
                    isDarkMode ? "hover:bg-neutral-700" : "hover:bg-neutral-200",
                  )}
                  aria-label="Close tab"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </button>
          ))}
          <button
            type="button"
            onClick={handleNewChat}
            className={clsx(
              "flex items-center gap-1 px-2 py-2 rounded-lg text-sm transition-colors ml-1",
              isDarkMode
                ? "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800"
                : "text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100",
            )}
            aria-label="New chat"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onToggle(false)}
            className={clsx(
              "p-2 rounded transition-colors ml-auto",
              isDarkMode
                ? "hover:bg-neutral-800 text-neutral-400"
                : "hover:bg-neutral-100 text-neutral-500",
            )}
            aria-label="Close chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {activeTab && (
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <Conversation className="flex-1 pb-32">
            {activeTab.messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center px-6 pb-32">
                <div className="text-center max-w-sm">
                  <h2
                    className={clsx(
                      "text-2xl font-semibold mb-2",
                      isDarkMode ? "text-white" : "text-neutral-900",
                    )}
                  >
                    Your AI Assistant
                  </h2>
                  <p
                    className={clsx(
                      "text-sm mb-6",
                      isDarkMode ? "text-neutral-400" : "text-neutral-600",
                    )}
                  >
                    Ask questions about the paper, request summaries, or explore key findings.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => handleSubmit("Summarize this paper")}
                      className={clsx(
                        "px-4 py-2 rounded-lg text-sm text-left transition-colors",
                        isDarkMode
                          ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
                          : "bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
                      )}
                    >
                      Summarize paper
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSubmit("What are the key findings?")}
                      className={clsx(
                        "px-4 py-2 rounded-lg text-sm text-left transition-colors",
                        isDarkMode
                          ? "bg-neutral-800 text-neutral-100 hover:bg-neutral-700"
                          : "bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
                      )}
                    >
                      Key findings
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ConversationContent className="pb-32">
                {activeTab.messages.map((message) => (
                  <Message key={message.id} from={message.role}>
                    <MessageAvatar from={message.role} />
                    <MessageContent
                      citations={message.citations}
                      reasoning={message.reasoning}
                    >
                      <div className="whitespace-pre-wrap">{message.content}</div>
                      {message.citations && message.citations.length > 0 && (
                        <Sources sources={message.citations} defaultVisible={true} />
                      )}
                      {message.reasoning && <Reasoning content={message.reasoning} />}
                    </MessageContent>
                  </Message>
                ))}
                {isSubmitting && (
                  <Message from="assistant">
                    <MessageAvatar from="assistant" />
                    <MessageContent>
                      <div
                        className={clsx(
                          "text-sm",
                          isDarkMode ? "text-neutral-400" : "text-neutral-600",
                        )}
                      >
                        Thinking...
                      </div>
                    </MessageContent>
                  </Message>
                )}
              </ConversationContent>
            )}
            <ConversationScrollButton />
          </Conversation>

          {/* Ingest button - shown after messages or input */}
          {activeTab.messages.length > 0 && onInsertBlocks && (
            <div
              className={clsx(
                "absolute bottom-20 left-0 right-0 flex items-center justify-center px-4 py-2 z-10",
                isDarkMode ? "bg-neutral-900/95 backdrop-blur-sm" : "bg-white/95 backdrop-blur-sm",
              )}
            >
              <button
                type="button"
                onClick={handleIngestToBlock}
                className={clsx(
                  "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
                  isDarkMode
                    ? "bg-blue-600 text-white hover:bg-blue-700"
                    : "bg-blue-500 text-white hover:bg-blue-600",
                )}
                title="Ingest last response to highlighted block in editor"
              >
                <Upload className="h-4 w-4" />
                <span>Ingest to highlighted block</span>
              </button>
            </div>
          )}

          {/* Floating input form */}
          <div
            className={clsx(
              "absolute bottom-0 left-0 right-0 z-20 p-4",
              isDarkMode ? "bg-neutral-900" : "bg-white",
            )}
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (input.trim() && !isSubmitting) {
                  handleSubmit(input);
                }
              }}
              className="relative"
            >
              <div className="flex-1 relative">
                <PromptInputTextarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onMentionTrigger={handleMentionTrigger}
                  placeholder="Ask, search, or make anything..."
                  className="w-full pr-20"
                />
                {/* Buttons inside textarea container, at right edge, vertically centered */}
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setInput("@");
                      const textarea = document.querySelector<HTMLTextAreaElement>(
                        'textarea[name="prompt"]',
                      );
                      textarea?.focus();
                    }}
                    className={clsx(
                      "flex items-center justify-center h-8 w-8 rounded transition-colors",
                      isDarkMode
                        ? "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                        : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200",
                    )}
                    title="Grab context (@) - Add PDF sections to chat question"
                  >
                    @
                  </button>
                  <PromptInputSubmit disabled={!input.trim() || isSubmitting} />
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
