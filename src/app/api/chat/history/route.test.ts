import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { GET, POST } from "./route";
import { requireAuthenticatedUserId } from "@/server/auth/user";
import { getChatMessagesForSession, saveChatMessages } from "@/server/db";

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

function createGetRequest(url: string): NextRequest {
  return new NextRequest(url);
}

describe("/api/chat/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("sanitizes and persists versioned answer trust metadata", async () => {
    const response = await POST(
      createPostRequest({
        sessionId: "chat_1",
        paperId: "paper-1",
        message: {
          id: "msg_1",
          role: "assistant",
          content: "answer",
          metadata: {
            version: 1,
            trust: {
              status: "sourced",
              hasEvidence: true,
              validCitationCount: 2.8,
              invalidCitationCount: -4,
              warnings: [" one ", "two", "x".repeat(300)],
              retrieval: {
                vector: {
                  status: "ok",
                  hitCount: 12.4,
                  reason: " source ".repeat(80),
                  apiKey: "drop-me",
                },
                text: {
                  status: "empty",
                  hitCount: 0,
                },
              },
              secret: "drop-me",
            },
            token: "drop-me",
          },
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
        metadata: {
          version: 1,
          trust: {
            status: "sourced",
            hasEvidence: true,
            validCitationCount: 2,
            invalidCitationCount: 0,
            warnings: ["one", "two", "x".repeat(240)],
            retrieval: {
              vector: {
                status: "ok",
                hitCount: 12,
                reason: " source ".repeat(80).trim().slice(0, 500),
              },
              text: {
                status: "empty",
                hitCount: 0,
              },
            },
          },
        },
        createdAt: 1,
      },
    ]);
  });

  it("rejects oversized answer metadata before persistence", async () => {
    const response = await POST(
      createPostRequest({
        sessionId: "chat_1",
        paperId: "paper-1",
        message: {
          id: "msg_1",
          role: "assistant",
          content: "answer",
          metadata: {
            version: 1,
            trust: {
              status: "sourced",
              hasEvidence: true,
              validCitationCount: 1,
              invalidCitationCount: 0,
              warnings: ["x".repeat(9000)],
              retrieval: {
                vector: { status: "ok", hitCount: 1 },
                text: { status: "ok", hitCount: 1 },
              },
            },
          },
          createdAt: 1,
        },
      }) as NextRequest,
    );

    expect(response.status).toBe(400);
    expect(saveChatMessages).not.toHaveBeenCalled();
  });

  it("round-trips persisted metadata through history reads", async () => {
    vi.mocked(getChatMessagesForSession).mockResolvedValue([
      {
        id: "msg_1",
        role: "assistant",
        content: "answer",
        metadata: {
          version: 1,
          trust: {
            status: "sourced",
            hasEvidence: true,
            validCitationCount: 1,
            invalidCitationCount: 0,
            warnings: [],
            retrieval: {
              vector: { status: "ok", hitCount: 3 },
              text: { status: "ok", hitCount: 2 },
            },
          },
        },
        createdAt: 1,
      } as unknown as Awaited<ReturnType<typeof getChatMessagesForSession>>[number],
    ]);

    const response = await GET(
      createGetRequest("http://localhost/api/chat/history?sessionId=chat_1"),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      messages: [
        {
          id: "msg_1",
          role: "assistant",
          content: "answer",
          metadata: {
            version: 1,
            trust: {
              status: "sourced",
              hasEvidence: true,
              validCitationCount: 1,
              invalidCitationCount: 0,
              warnings: [],
              retrieval: {
                vector: { status: "ok", hitCount: 3 },
                text: { status: "ok", hitCount: 2 },
              },
            },
          },
          createdAt: 1,
        },
      ],
    });
  });

  it("returns legacy unavailable metadata for assistant rows without metadata", async () => {
    vi.mocked(getChatMessagesForSession).mockResolvedValue([
      {
        id: "msg_1",
        role: "assistant",
        content: "old answer",
        createdAt: 1,
      },
      {
        id: "msg_2",
        role: "user",
        content: "question",
        createdAt: 2,
      },
    ]);

    const response = await GET(
      createGetRequest("http://localhost/api/chat/history?sessionId=chat_1"),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.messages[0].metadata).toMatchObject({
      version: 1,
      trust: {
        status: "unavailable",
        hasEvidence: false,
        validCitationCount: 0,
        invalidCitationCount: 0,
        retrieval: {
          vector: { status: "unavailable", hitCount: 0 },
          text: { status: "unavailable", hitCount: 0 },
        },
      },
    });
    expect(payload.messages[1]).not.toHaveProperty("metadata");
  });
});
