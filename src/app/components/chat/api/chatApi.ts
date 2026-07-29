/**
 * Every network call the chat surface makes. Nothing else in `chat/` calls
 * `fetch`, so the route contract is changeable in one file.
 *
 * Routes: `POST/GET/DELETE /api/chat/history`, `POST /api/chat/session`, `POST /api/qa`.
 */
import type { QuestionSelection } from "@/server/qa/types";

import {
  toPersistedMessage,
  type ChatAnswerResponse,
  type ChatHistoryResponse,
  type ChatMessage,
  type ChatSessionResponse,
} from "../model/types";

async function readResponseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  return payload?.error ?? fallback;
}

export async function createChatSession(paperId: string): Promise<string> {
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

export async function fetchChatHistory(paperId: string): Promise<ChatHistoryResponse> {
  const response = await fetch(`/api/chat/history?paperId=${encodeURIComponent(paperId)}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Failed to load saved chats."));
  }

  return (await response.json()) as ChatHistoryResponse;
}

export async function saveChatMessage(
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
      message: toPersistedMessage(message),
    }),
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Failed to save chat history."));
  }
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  const response = await fetch(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error(await readResponseError(response, "Failed to delete chat session."));
  }
}

export async function askQuestion(params: {
  paperId: string;
  question: string;
  selection?: QuestionSelection;
  /** Pins the answer to one local CLI agent when the picker is in use. */
  localAgent?: string;
  fallbackError?: string;
}): Promise<ChatAnswerResponse> {
  const response = await fetch("/api/qa", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paperId: params.paperId,
      question: params.question,
      selection: params.selection,
      localAgent: params.localAgent,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await readResponseError(
        response,
        params.fallbackError ?? `QA request failed with status ${response.status}.`,
      ),
    );
  }

  return (await response.json()) as ChatAnswerResponse;
}
