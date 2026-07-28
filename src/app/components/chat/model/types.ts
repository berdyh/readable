/**
 * Chat data shapes shared by the sidecar, the inline panel, the hooks and the
 * API glue. Pure types only — no React, no fetch, no DOM.
 *
 * `QuestionSelection` / `AnswerResult` are still imported from `@/server/qa/types`
 * (types-only import, per the client/server rule in CLAUDE.md).
 */
import type { AnswerTrustMetadata } from "../primitives/answer-card";
import type { Source } from "../primitives/sources";

export type ChatRole = "user" | "assistant";

export interface ChatMessageMetadata {
  version: 1;
  trust?: AnswerTrustMetadata;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  citations?: Source[];
  reasoning?: string;
  trust?: AnswerTrustMetadata;
  metadata?: ChatMessageMetadata;
  createdAt: number;
  status?: "error";
}

/** One saved conversation, rendered as a tab in the sidecar's tab strip. */
export interface ChatTab {
  id: string;
  title: string;
  messages: ChatMessage[];
  sessionId: string | null;
}

/** `POST /api/chat/session` response. */
export interface ChatSessionResponse {
  session: {
    id: string;
    paperId: string;
    createdAt: string;
  };
}

/** `GET /api/chat/history` response. Both shapes are accepted for compatibility. */
export interface ChatHistoryResponse {
  sessions?: Array<{
    sessionId: string;
    messages: ChatMessage[];
    createdAt: number;
    updatedAt: number;
  }>;
  messages?: ChatMessage[];
}

/** `POST /api/qa` response, narrowed to what the chat surface consumes. */
export interface ChatAnswerResponse {
  answer: string;
  cites?: Source[];
  reasoning?: string;
  trust?: AnswerTrustMetadata;
}

export function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDraftTab(): ChatTab {
  return {
    id: createLocalId("chat"),
    title: "New chat",
    messages: [],
    sessionId: null,
  };
}

export function titleFromQuestion(question: string): string {
  const compact = question.replace(/\s+/g, " ").trim();
  if (!compact) return "New chat";
  return compact.length > 42 ? `${compact.slice(0, 39)}…` : compact;
}

/**
 * Older persisted messages carried trust under `metadata.trust` only. Lift it to
 * the top level so rendering has a single source of truth.
 */
export function normalizeHistoryMessage(message: ChatMessage): ChatMessage {
  if (message.trust || !message.metadata?.trust) {
    return message;
  }

  return { ...message, trust: message.metadata.trust };
}

/** Mirror `trust` down into `metadata` so the persisted row round-trips. */
export function toPersistedMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    metadata:
      message.metadata ??
      (message.role === "assistant" && message.trust
        ? { version: 1 as const, trust: message.trust }
        : undefined),
  };
}
