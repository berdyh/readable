"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUser } from "@clerk/nextjs";

import type { QuestionSelection } from "@/server/qa/types";

import {
  askQuestion,
  createChatSession,
  deleteChatSession,
  fetchChatHistory,
  saveChatMessage,
} from "../api/chatApi";
import {
  createDraftTab,
  createLocalId,
  fromWireMessage,
  titleFromQuestion,
  withSourceLabel,
  type ChatMessage,
  type ChatTab,
} from "../model/types";

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * All persisted-chat state for the sidecar: tabs, messages, the active session,
 * loading/error flags, and the send pipeline. The panel components below it are
 * pure presentation driven by what this returns.
 */
export function useChatSessions({
  paperId,
  isOpen,
  enabled,
  selection,
  onSelectionClear,
  localAgent,
}: {
  paperId: string;
  isOpen: boolean;
  /** Gate history loading until the host is mounted, avoiding an SSR fetch. */
  enabled: boolean;
  selection?: QuestionSelection;
  onSelectionClear?: () => void;
  /** Local CLI agent chosen in the picker; ignored on hosted providers. */
  localAgent?: string;
}) {
  const { isLoaded, isSignedIn } = useUser();

  const [tabs, setTabs] = useState<ChatTab[]>(() => [createDraftTab()]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedText = selection?.text?.trim();

  useEffect(() => {
    if (!isOpen || !paperId || !enabled || !isLoaded) {
      return;
    }

    if (!isSignedIn) {
      setIsLoadingHistory(false);
      setTabs([createDraftTab()]);
      setActiveTabId(null);
      setError(null);
      return;
    }

    let cancelled = false;

    const loadChatHistory = async () => {
      setIsLoadingHistory(true);
      setError(null);

      try {
        const result = await fetchChatHistory(paperId);
        if (cancelled) return;

        if (result.sessions && result.sessions.length > 0) {
          const loadedTabs = result.sessions.map((session, index) => ({
            id: `chat-${session.sessionId}`,
            title: titleFromQuestion(
              session.messages.find((message) => message.role === "user")?.content ??
                `Chat ${index + 1}`,
            ),
            messages: session.messages.map(fromWireMessage),
            sessionId: session.sessionId,
          }));
          setTabs(loadedTabs);
          setActiveTabId(loadedTabs[0]?.id ?? null);
          return;
        }

        const draftTab = createDraftTab();
        setTabs([draftTab]);
        setActiveTabId(draftTab.id);
      } catch (caught) {
        if (cancelled) return;
        setError(errorMessage(caught, "Failed to load saved chats."));
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
  }, [enabled, isLoaded, isOpen, isSignedIn, paperId]);

  const activeTab = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0],
    [activeTabId, tabs],
  );

  const lastAssistantMessage = useMemo(
    () =>
      activeTab?.messages
        .slice()
        .reverse()
        .find((message) => message.role === "assistant" && message.status !== "error"),
    [activeTab],
  );

  const startNewChat = useCallback(async () => {
    if (!isSignedIn) {
      setError("Sign in to start a saved chat.");
      return;
    }

    try {
      const sessionId = await createChatSession(paperId);
      const newTab: ChatTab = {
        id: `chat-${sessionId}`,
        title: "New chat",
        messages: [],
        sessionId,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTab.id);
      setError(null);
    } catch (caught) {
      setError(errorMessage(caught, "Failed to create chat session."));
    }
  }, [isSignedIn, paperId]);

  const closeTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((item) => item.id === tabId);
      if (tab?.sessionId) {
        try {
          await deleteChatSession(tab.sessionId);
        } catch (caught) {
          setError(errorMessage(caught, "Failed to delete chat session."));
          return;
        }
      }

      setError(null);
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
        setError("Sign in to ask saved questions.");
        return;
      }

      setIsSubmitting(true);
      setError(null);

      let sessionId = activeTab.sessionId;
      let userMessage: ChatMessage | null = null;

      try {
        if (!sessionId) {
          sessionId = await createChatSession(paperId);
          const resolvedSessionId = sessionId;
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTab.id
                ? { ...tab, sessionId: resolvedSessionId, id: `chat-${resolvedSessionId}` }
                : tab,
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

        const pendingUserMessage = userMessage;
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === activeTab.id || tab.sessionId === sessionId
              ? {
                  ...tab,
                  title: tab.messages.length === 0 ? titleFromQuestion(question) : tab.title,
                  messages: [...tab.messages, pendingUserMessage],
                }
              : tab,
          ),
        );

        await saveChatMessage(sessionId, paperId, userMessage);

        const result = await askQuestion({
          paperId,
          question,
          selection: selectedText ? selection : undefined,
          localAgent,
          fallbackError: "Failed to answer the question.",
        });

        const assistantMessage: ChatMessage = {
          id: createLocalId("msg"),
          role: "assistant",
          content: result.answer,
          citations: result.cites,
          reasoning: result.reasoning,
          trust: withSourceLabel(result.trust, result.source),
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
      } catch (caught) {
        const message = errorMessage(caught, "Unexpected chat error occurred.");
        setError(message);

        if (userMessage) {
          const failure: ChatMessage = {
            id: createLocalId("msg"),
            role: "assistant",
            content: message,
            createdAt: Date.now(),
            status: "error",
          };
          setTabs((prev) =>
            prev.map((tab) =>
              tab.id === activeTab.id || tab.sessionId === sessionId
                ? { ...tab, messages: [...tab.messages, failure] }
                : tab,
            ),
          );
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeTab,
      isSignedIn,
      isSubmitting,
      localAgent,
      onSelectionClear,
      paperId,
      selectedText,
      selection,
    ],
  );

  return {
    isLoaded,
    isSignedIn,
    tabs,
    activeTab,
    setActiveTabId,
    lastAssistantMessage,
    isSubmitting,
    isLoadingHistory,
    error,
    setError,
    startNewChat,
    closeTab,
    sendQuestion,
  };
}
