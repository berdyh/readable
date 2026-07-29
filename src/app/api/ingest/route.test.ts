import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => {
  const AUTH_REQUIRED_MESSAGE = "Sign in to use personalized reading features.";

  class AuthenticationRequiredError extends Error {
    constructor(message = AUTH_REQUIRED_MESSAGE) {
      super(message);
      this.name = "AuthenticationRequiredError";
    }
  }

  return { AUTH_REQUIRED_MESSAGE, AuthenticationRequiredError };
});

vi.mock("@/server/auth", () => ({
  AUTH_REQUIRED_MESSAGE: authMock.AUTH_REQUIRED_MESSAGE,
  AuthenticationRequiredError: authMock.AuthenticationRequiredError,
  isAuthenticationRequiredError: vi.fn(
    (error: unknown) => error instanceof authMock.AuthenticationRequiredError,
  ),
  requireAuthenticatedUserId: vi.fn(),
}));

vi.mock("@/server/ingest", () => ({
  ingestPaper: vi.fn(),
}));

import {
  AUTH_REQUIRED_MESSAGE,
  AuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { ingestPaper } from "@/server/ingest";

import { POST } from "./route";

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/ingest", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("/api/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue("user_123");
    vi.mocked(ingestPaper).mockResolvedValue({
      paperId: "1706.03762",
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      sections: [],
      refs: [],
      figures: [],
    });
  });

  it("returns 401 before ingesting when authentication is required", async () => {
    vi.mocked(requireAuthenticatedUserId).mockRejectedValue(new AuthenticationRequiredError());
    const request = {
      json: vi.fn().mockRejectedValue(new Error("body should not be parsed")),
    } as unknown as NextRequest;

    const response = await POST(request);

    await expect(response.json()).resolves.toEqual({
      error: AUTH_REQUIRED_MESSAGE,
    });
    expect(response.status).toBe(401);
    expect(request.json).not.toHaveBeenCalled();
    expect(ingestPaper).not.toHaveBeenCalled();
  });

  it("ingests a paper for a signed-in request", async () => {
    const response = await POST(
      createPostRequest({
        arxivId: " 1706.03762 ",
        contactEmail: " reader@example.com ",
        forceOcr: true,
      }) as NextRequest,
    );

    await expect(response.json()).resolves.toMatchObject({
      paperId: "1706.03762",
      title: "Attention Is All You Need",
    });
    expect(response.status).toBe(201);
    expect(requireAuthenticatedUserId).toHaveBeenCalledTimes(1);
    expect(ingestPaper).toHaveBeenCalledWith({
      arxivId: "1706.03762",
      contactEmail: "reader@example.com",
      forceOcr: true,
    });
  });
});
