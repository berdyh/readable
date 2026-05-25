import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { POST } from "./route";
import { requireAuthenticatedUserId } from "@/server/auth/user";
import { saveChatMessages } from "@/server/db";

vi.mock("@/server/auth/user", () => ({
  AUTH_REQUIRED_MESSAGE: "Sign in to use personalized reading features.",
  isAuthenticationRequiredError: vi.fn(() => false),
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  ChatSessionOwnershipError: class ChatSessionOwnershipError extends Error {},
  deleteChatSession: vi.fn(),
  getChatMessagesForSession: vi.fn(),
  listChatSessionsForPaper: vi.fn(),
  saveChatMessages: vi.fn(),
}));

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/chat/history", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("/api/chat/history", () => {
  beforeEach(() => {
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue("user_123");
    vi.mocked(saveChatMessages).mockResolvedValue(1);
  });

  it("rejects malformed citation arrays before persistence", async () => {
    const response = await POST(
      createPostRequest({
        sessionId: "chat_1",
        paperId: "paper-1",
        message: {
          id: "msg_1",
          role: "assistant",
          content: "answer",
          citations: ["not-a-citation"],
          createdAt: 1,
        },
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(saveChatMessages).not.toHaveBeenCalled();
  });

  it("sanitizes citation metadata before persistence", async () => {
    const response = await POST(
      createPostRequest({
        sessionId: "chat_1",
        paperId: "paper-1",
        message: {
          id: "msg_1",
          role: "assistant",
          content: "answer",
          citations: [
            {
              chunkId: " chunk-1 ",
              quote: " cited text ",
              page: 2,
              ignored: "drop me",
            },
          ],
          createdAt: 1,
        },
      }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(saveChatMessages).toHaveBeenCalledWith("user_123", "paper-1", "chat_1", [
      {
        id: "msg_1",
        role: "assistant",
        content: "answer",
        citations: [{ chunkId: "chunk-1", quote: "cited text", page: 2 }],
        createdAt: 1,
      },
    ]);
  });
});
