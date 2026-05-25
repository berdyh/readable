"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SignInButton, SignUpButton, useUser } from "@clerk/nextjs";
import { useTheme } from "next-themes";
import {
  BookOpenText,
  GripVertical,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  PanelRightClose,
  Send,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { clsx } from "clsx";

import type { Block } from "./types";
import type { QuestionSelection } from "@/server/qa/types";
import { Conversation, ConversationContent } from "../ai-chatbot/conversation";
import { Message, MessageAvatar } from "../ai-chatbot/message";
import { PromptInputTextarea } from "../ai-chatbot/prompt-input";
import { Reasoning } from "../ai-chatbot/reasoning";
import { Sources, type Source } from "../ai-chatbot/sources";

interface ChatIntegrationProps {
  paperId: string;
  isOpen: boolean;
  onToggle: (open: boolean) => void;
  onInsertBlocks?: (blocks: Block[], insertIndex?: number) => void;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
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
  citations?: Source[];
  reasoning?: string;
  createdAt: number;
  status?: "error";
}

interface ChatSessionResponse {
  session: {
    id: string;
    paperId: string;
    createdAt: string;
  };
}

interface ChatHistoryResponse {
  sessions?: Array<{
    sessionId: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
  }>;
  messages?: ChatMessage[];
}

const QUICK_PROMPTS = [
  "Summarize this paper",
  "What are the key findings?",
  "What are the main limitations?",
];
const CHAT_PANEL_WIDTH_STORAGE_KEY = "readable:chat-panel-width";
const DEFAULT_CHAT_PANEL_WIDTH = 460;
const MIN_CHAT_PANEL_WIDTH = 360;
const MAX_CHAT_PANEL_WIDTH = 760;
const DESKTOP_PANEL_MARGIN = 80;

function getPanelWidthBounds(): { min: number; max: number } {
  if (typeof window === "undefined") {
    return {
      min: MIN_CHAT_PANEL_WIDTH,
      max: MAX_CHAT_PANEL_WIDTH,
    };
  }

  const viewportWidth = window.innerWidth;
  if (viewportWidth < 640) {
    return {
      min: viewportWidth,
      max: viewportWidth,
    };
  }

  const max = Math.min(MAX_CHAT_PANEL_WIDTH, viewportWidth - DESKTOP_PANEL_MARGIN);
  const min = Math.min(MIN_CHAT_PANEL_WIDTH, max);
  return { min, max: Math.max(min, max) };
}

function clampChatPanelWidth(width: number): number {
  const { min, max } = getPanelWidthBounds();
  if (!Number.isFinite(width)) {
    return Math.min(DEFAULT_CHAT_PANEL_WIDTH, max);
  }
  return Math.min(Math.max(width, min), max);
}

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createDraftTab(): ChatTab {
  return {
    id: createLocalId("chat"),
    title: "New chat",
    messages: [],
    sessionId: null,
  };
}

function titleFromQuestion(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  if (!compact) return "New chat";
  return compact.length > 42 ? `${compact.slice(0, 39)}...` : compact;
}

async function readResponseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

async function createRemoteSession(paperId: string): Promise<string> {
  const response = await fetch("/api/chat/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Failed to create chat session."));
  }

  const payload = (await response.json()) as ChatSessionResponse;
  return payload.session.id;
}

async function saveChatMessage(
  sessionId: string,
  paperId: string,
  message: ChatMessage,
): Promise<void> {
  const response = await fetch("/api/chat/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId,
      paperId,
      message,
    }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Failed to save chat history."));
  }
}

async function deleteChatSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Failed to delete chat session."));
  }
}

/**
 * Floating AI chat button that opens chat panel.
 */
export function ChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-8 right-8 z-50 flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-zinc-950 text-white shadow-xl transition hover:-translate-y-0.5 hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2 dark:border-zinc-700 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
      aria-label="Open research chat"
      title="Open research chat"
    >
      <MessageSquare className="h-6 w-6" />
    </button>
  );
}

function ChatMessageBubble({ message, paperId }: { message: ChatMessage; paperId: string }) {
  const isUser = message.role === "user";
  const isError = message.status === "error";

  return (
    <Message from={message.role} className="items-start">
      <MessageAvatar from={message.role} />
      <div
        className={clsx("flex max-w-[82%] flex-col gap-2", isUser ? "items-end" : "items-start")}
      >
        <div
          className={clsx(
            "rounded-lg px-4 py-3 text-sm leading-relaxed shadow-sm",
            "break-words",
            isUser && "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950",
            !isUser &&
              !isError &&
              "border border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
            isError &&
              "border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200",
          )}
        >
          <div className="whitespace-pre-wrap">{message.content}</div>
        </div>

        {!isUser && message.citations && message.citations.length > 0 && (
          <Sources sources={message.citations} defaultVisible={false} paperId={paperId} />
        )}

        {!isUser && message.reasoning && <Reasoning content={message.reasoning} />}
      </div>
    </Message>
  );
}

function AuthRequiredPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-emerald-500" />
          <h2 className="text-sm font-semibold">Research chat</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="space-y-2">
            <h3 className="text-base font-semibold">Sign in to chat</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Saved chats, sources, and reading preferences are tied to your account.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <SignInButton>
              <button
                type="button"
                className="rounded-lg bg-zinc-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button
                type="button"
                className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-800 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-900"
              >
                Sign up
              </button>
            </SignUpButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Block editor AI chat side panel with saved sessions.
 */
export function ChatSidePanel({
  paperId,
  isOpen,
  onToggle,
  onInsertBlocks,
  selection,
  onSelectionClear,
}: ChatIntegrationProps) {
  const { resolvedTheme } = useTheme();
  const { isLoaded, isSignedIn } = useUser();
  const [mounted, setMounted] = useState(false);
  const [tabs, setTabs] = useState<ChatTab[]>(() => [createDraftTab()]);
  const [activeTabId, setActiveTabId] = useState<string | null>(tabs[0]?.id ?? null);
  const [input, setInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(DEFAULT_CHAT_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    const savedWidth = Number(window.localStorage.getItem(CHAT_PANEL_WIDTH_STORAGE_KEY));
    setPanelWidth(clampChatPanelWidth(savedWidth || DEFAULT_CHAT_PANEL_WIDTH));
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) {
      return;
    }

    window.localStorage.setItem(CHAT_PANEL_WIDTH_STORAGE_KEY, String(panelWidth));
  }, [mounted, panelWidth]);

  useEffect(() => {
    const handleResize = () => {
      setPanelWidth((current) => clampChatPanelWidth(current));
    };

    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    if (!isResizing) {
      return;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing]);

  useEffect(() => {
    if (!isOpen || !paperId || !mounted || !isLoaded) {
      return;
    }

    if (!isSignedIn) {
      setIsLoadingHistory(false);
      setTabs([createDraftTab()]);
      setActiveTabId(null);
      setPanelError(null);
      return;
    }

    let cancelled = false;

    const loadChatHistory = async () => {
      setIsLoadingHistory(true);
      setPanelError(null);

      try {
        const response = await fetch(`/api/chat/history?paperId=${encodeURIComponent(paperId)}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response, "Failed to load saved chats."));
        }

        const result = (await response.json()) as ChatHistoryResponse;
        if (cancelled) return;

        if (result.sessions && result.sessions.length > 0) {
          const loadedTabs = result.sessions.map((session, index) => ({
            id: `chat-${session.sessionId}`,
            title: titleFromQuestion(
              session.messages.find((message) => message.role === "user")?.content ??
                `Chat ${index + 1}`,
            ),
            messages: session.messages,
            sessionId: session.sessionId,
          }));
          setTabs(loadedTabs);
          setActiveTabId(loadedTabs[0]?.id ?? null);
        } else {
          const draftTab = createDraftTab();
          setTabs([draftTab]);
          setActiveTabId(draftTab.id);
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Failed to load saved chats.";
        setPanelError(message);
        const draftTab = createDraftTab();
        setTabs([draftTab]);
        setActiveTabId(draftTab.id);
      } finally {
        if (!cancelled) {
          setIsLoadingHistory(false);
        }
      }
    };

    void loadChatHistory();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isOpen, isSignedIn, mounted, paperId]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );
  const isDarkMode = mounted && resolvedTheme === "dark";
  const selectedText = selection?.text?.trim();
  const lastAssistantMessage = activeTab?.messages
    .slice()
    .reverse()
    .find((message) => message.role === "assistant" && message.status !== "error");

  const updatePanelWidthFromClientX = useCallback((clientX: number) => {
    setPanelWidth(clampChatPanelWidth(window.innerWidth - clientX));
  }, []);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsResizing(true);
      updatePanelWidthFromClientX(event.clientX);

      const handlePointerMove = (moveEvent: PointerEvent) => {
        updatePanelWidthFromClientX(moveEvent.clientX);
      };

      const stopResize = () => {
        setIsResizing(false);
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", stopResize);
        window.removeEventListener("pointercancel", stopResize);
      };

      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", stopResize);
      window.addEventListener("pointercancel", stopResize);
    },
    [updatePanelWidthFromClientX],
  );

  const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setPanelWidth((current) => clampChatPanelWidth(current + step));
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setPanelWidth((current) => clampChatPanelWidth(current - step));
    } else if (event.key === "Home") {
      event.preventDefault();
      setPanelWidth(getPanelWidthBounds().max);
    } else if (event.key === "End") {
      event.preventDefault();
      setPanelWidth(getPanelWidthBounds().min);
    }
  }, []);

  const handleNewChat = useCallback(async () => {
    if (!isSignedIn) {
      setPanelError("Sign in to start a saved chat.");
      return;
    }

    try {
      const sessionId = await createRemoteSession(paperId);
      const newTab: ChatTab = {
        id: `chat-${sessionId}`,
        title: "New chat",
        messages: [],
        sessionId,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setInput("");
      setPanelError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create chat session.";
      setPanelError(message);
    }
  }, [isSignedIn, paperId]);

  const handleIngestToBlock = useCallback(() => {
    if (!lastAssistantMessage || !onInsertBlocks) {
      return;
    }

    onInsertBlocks([
      {
        id: createLocalId("chat"),
        type: "callout",
        content: lastAssistantMessage.content,
        metadata: { type: "info", locked: true },
      },
    ]);
  }, [lastAssistantMessage, onInsertBlocks]);

  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((item) => item.id === tabId);
      if (tab?.sessionId) {
        try {
          await deleteChatSession(tab.sessionId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Failed to delete chat session.";
          setPanelError(message);
          return;
        }
      }

      setPanelError(null);
      if (tabs.length <= 1) {
        const nextTab = createDraftTab();
        setTabs([nextTab]);
        setActiveTabId(nextTab.id);
        return;
      }

      const remainingTabs = tabs.filter((item) => item.id !== tabId);
      setTabs(remainingTabs);
      if (activeTabId === tabId) {
        setActiveTabId(remainingTabs[0]?.id ?? null);
      }
    },
    [activeTabId, tabs],
  );

  const sendQuestion = useCallback(
    async (rawQuestion: string) => {
      const question = rawQuestion.trim();
      if (!question || !activeTab || isSubmitting) {
        return;
      }
      if (!isSignedIn) {
        setPanelError("Sign in to ask saved questions.");
        return;
      }

      setIsSubmitting(true);
      setPanelError(null);

      let sessionId = activeTab.sessionId;
      let userMessage: ChatMessage | null = null;

      try {
        if (!sessionId) {
          sessionId = await createRemoteSession(paperId);
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTab.id ? { ...tab, sessionId, id: `chat-${sessionId}` } : tab,
            ),
          );
          setActiveTabId(`chat-${sessionId}`);
        }

        userMessage = {
          id: createLocalId("msg"),
          role: "user",
          content: question,
          createdAt: Date.now(),
        };

        setInput("");
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTab.id || tab.sessionId === sessionId
              ? {
                  ...tab,
                  title: tab.messages.length === 0 ? titleFromQuestion(question) : tab.title,
                  messages: [...tab.messages, userMessage!],
                }
              : tab,
          ),
        );

        await saveChatMessage(sessionId, paperId, userMessage);

        const response = await fetch("/api/qa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            paperId,
            question,
            selection: selectedText ? selection : undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(await readResponseError(response, "Failed to answer the question."));
        }

        const result = (await response.json()) as {
          answer: string;
          cites?: Source[];
          reasoning?: string;
        };

        const assistantMessage: ChatMessage = {
          id: createLocalId("msg"),
          role: "assistant",
          content: result.answer,
          citations: result.cites,
          reasoning: result.reasoning,
          createdAt: Date.now(),
        };

        setTabs((prev) =>
          prev.map((tab) =>
            tab.sessionId === sessionId
              ? { ...tab, messages: [...tab.messages, assistantMessage] }
              : tab,
          ),
        );

        await saveChatMessage(sessionId, paperId, assistantMessage);

        if (selectedText) {
          onSelectionClear?.();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unexpected chat error occurred.";
        const errorMessage: ChatMessage = {
          id: createLocalId("msg"),
          role: "assistant",
          content: message,
          createdAt: Date.now(),
          status: "error",
        };
        setPanelError(message);
        if (userMessage) {
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTab.id || tab.sessionId === sessionId
                ? { ...tab, messages: [...tab.messages, errorMessage] }
                : tab,
            ),
          );
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [activeTab, isSignedIn, isSubmitting, onSelectionClear, paperId, selectedText, selection],
  );

  if (!isOpen || !mounted) {
    return null;
  }

  return (
    <aside
      className={clsx(
        "fixed inset-y-0 right-0 z-50 flex h-dvh flex-col border-l shadow-2xl",
        isResizing && "select-none",
        isDarkMode
          ? "border-zinc-800 bg-zinc-950 text-zinc-100"
          : "border-zinc-200 bg-zinc-50 text-zinc-950",
      )}
      style={{ width: `${panelWidth}px` }}
      aria-label="Research chat"
    >
      <div
        role="separator"
        aria-label="Resize chat panel"
        aria-orientation="vertical"
        aria-valuemin={getPanelWidthBounds().min}
        aria-valuemax={getPanelWidthBounds().max}
        aria-valuenow={Math.round(panelWidth)}
        tabIndex={0}
        title="Resize chat panel"
        onPointerDown={handleResizePointerDown}
        onKeyDown={handleResizeKeyDown}
        className={clsx(
          "group absolute inset-y-0 left-0 z-20 flex w-3 -translate-x-1.5 cursor-col-resize touch-none items-center justify-center outline-none",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-zinc-300 after:transition after:content-['']",
          "hover:after:w-1 hover:after:bg-emerald-500 focus-visible:after:w-1 focus-visible:after:bg-emerald-500",
          "dark:after:bg-zinc-700 dark:hover:after:bg-emerald-400 dark:focus-visible:after:bg-emerald-400",
          isResizing && "after:w-1 after:bg-emerald-500 dark:after:bg-emerald-400",
        )}
      >
        <GripVertical className="pointer-events-none h-5 w-5 rounded bg-white/80 p-0.5 text-zinc-400 opacity-0 shadow-sm transition group-hover:opacity-100 group-focus-visible:opacity-100 dark:bg-zinc-950/80 dark:text-zinc-500" />
      </div>
      {!isLoaded ? (
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : !isSignedIn ? (
        <AuthRequiredPanel onClose={() => onToggle(false)} />
      ) : (
        <>
          <header className="flex shrink-0 flex-col border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                  <MessageSquare className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-semibold">Research chat</h2>
                  <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{paperId}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleNewChat}
                  disabled={isSubmitting}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  aria-label="New chat"
                  title="New chat"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => onToggle(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
                  aria-label="Close chat"
                  title="Close chat"
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex gap-1 overflow-x-auto px-3 pb-2">
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={clsx(
                    "group inline-flex h-8 max-w-[190px] shrink-0 items-center rounded-lg border text-xs transition",
                    activeTab?.id === tab.id
                      ? "border-zinc-300 bg-zinc-100 text-zinc-950 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
                      : "border-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-100",
                  )}
                  title={tab.title}
                >
                  <button
                    type="button"
                    onClick={() => setActiveTabId(tab.id)}
                    className="min-w-0 flex-1 truncate px-2.5 py-1.5 text-left"
                  >
                    {tab.title}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCloseTab(tab.id)}
                    disabled={isSubmitting}
                    className="mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 opacity-0 transition hover:bg-zinc-200 hover:text-rose-600 focus:opacity-100 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-zinc-400 group-hover:opacity-100 dark:hover:bg-zinc-800"
                    aria-label="Delete chat tab"
                    title="Delete chat tab"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </header>

          {isLoadingHistory ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Loading saved chats</span>
            </div>
          ) : (
            <>
              <Conversation className="min-h-0 flex-1">
                <ConversationContent className="flex min-h-0 flex-1 flex-col gap-4 space-y-0 px-4 py-4">
                  {!activeTab || activeTab.messages.length === 0 ? (
                    <div className="flex flex-1 items-center justify-center">
                      <div className="flex w-full max-w-sm flex-col gap-3">
                        <div className="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">
                          <Sparkles className="h-4 w-4 text-emerald-500" />
                          Start a paper chat
                        </div>
                        <div className="grid gap-2">
                          {QUICK_PROMPTS.map((prompt) => (
                            <button
                              key={prompt}
                              type="button"
                              onClick={() => void sendQuestion(prompt)}
                              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-left text-sm text-zinc-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-emerald-700 dark:hover:bg-emerald-950/30"
                            >
                              {prompt}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    activeTab.messages.map((message) => (
                      <ChatMessageBubble key={message.id} message={message} paperId={paperId} />
                    ))
                  )}

                  {isSubmitting && (
                    <Message from="assistant" className="items-start">
                      <MessageAvatar from="assistant" />
                      <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-500 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Thinking
                        </span>
                      </div>
                    </Message>
                  )}
                </ConversationContent>
              </Conversation>

              <footer className="shrink-0 border-t border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
                {selectedText && (
                  <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <BookOpenText className="h-3.5 w-3.5" />
                        Selected context
                      </span>
                      <button
                        type="button"
                        onClick={onSelectionClear}
                        className="rounded px-1.5 py-0.5 font-medium text-amber-700 transition hover:bg-amber-100 dark:text-amber-200 dark:hover:bg-amber-900/50"
                      >
                        Clear
                      </button>
                    </div>
                    <p className="line-clamp-3 whitespace-pre-wrap">{selectedText}</p>
                  </div>
                )}

                {panelError && (
                  <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200">
                    {panelError}
                  </div>
                )}

                {lastAssistantMessage && onInsertBlocks && (
                  <div className="mb-3 flex justify-end">
                    <button
                      type="button"
                      onClick={handleIngestToBlock}
                      className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-900"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Insert answer
                    </button>
                  </div>
                )}

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void sendQuestion(input);
                  }}
                  className="flex items-end gap-2"
                >
                  <PromptInputTextarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder={
                      selectedText ? "Ask about the selected passage" : "Ask about this paper"
                    }
                    className="min-h-[48px] flex-1 pr-3"
                    disabled={isSubmitting}
                  />
                  <button
                    type="submit"
                    disabled={!input.trim() || isSubmitting}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-zinc-950 text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    aria-label="Send message"
                    title="Send message"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </form>
              </footer>
            </>
          )}
        </>
      )}
    </aside>
  );
}
