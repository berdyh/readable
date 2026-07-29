import type { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/editor")>();
  return {
    ...actual,
    ingestArxivInline: vi.fn(),
  };
});

import { ingestArxivInline } from "@/server/editor";

import { POST } from "./route";

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

function createPostRequest(body: unknown): Request {
  return new Request("http://localhost/api/editor/ingest/arxiv", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

describe("/api/editor/ingest/arxiv", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(ingestArxivInline).mockResolvedValue({
      arxivId: "1706.03762",
      title: "Attention Is All You Need",
      authors: ["Ashish Vaswani"],
      categories: ["cs.CL"],
      sections: [
        {
          id: "intro",
          title: "Introduction",
          level: 1,
          paragraphs: ["A transformer paper."],
        },
      ],
      figures: [],
      sourceUrl: "https://arxiv.org/abs/1706.03762",
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("ingests arXiv content inline as a public read-only request", async () => {
    const response = await POST(createPostRequest({ target: " 1706.03762 " }) as NextRequest);

    await expect(response.json()).resolves.toMatchObject({
      arxivId: "1706.03762",
      title: "Attention Is All You Need",
    });
    expect(response.status).toBe(200);
    expect(ingestArxivInline).toHaveBeenCalledWith("1706.03762");
  });

  it("normalizes arxiv.org abs URLs before inline ingestion", async () => {
    const response = await POST(
      createPostRequest({ target: "https://arxiv.org/abs/1706.03762v7?context=cs" }) as NextRequest,
    );

    expect(response.status).toBe(200);
    expect(ingestArxivInline).toHaveBeenCalledWith("1706.03762");
  });

  it("returns 400 before inline arXiv ingestion when the body is invalid", async () => {
    const response = await POST(createPostRequest({ target: " " }) as NextRequest);

    await expect(response.json()).resolves.toEqual({
      error: 'Field "target" is required.',
    });
    expect(response.status).toBe(400);
    expect(ingestArxivInline).not.toHaveBeenCalled();
  });

  it("returns 400 before network work for arbitrary URLs", async () => {
    const response = await POST(
      createPostRequest({ target: "https://example.com/papers/1706.03762" }) as NextRequest,
    );

    await expect(response.json()).resolves.toEqual({
      error: "Enter an arXiv ID or arxiv.org/abs URL.",
    });
    expect(response.status).toBe(400);
    expect(ingestArxivInline).not.toHaveBeenCalled();
  });

  it("returns 400 before network work for malformed targets", async () => {
    const response = await POST(createPostRequest({ target: "not-an-arxiv-id" }) as NextRequest);

    await expect(response.json()).resolves.toEqual({
      error: "Enter an arXiv ID or arxiv.org/abs URL.",
    });
    expect(response.status).toBe(400);
    expect(ingestArxivInline).not.toHaveBeenCalled();
  });

  it("maps timeout failures to 504 without exposing upstream details", async () => {
    vi.mocked(ingestArxivInline).mockRejectedValueOnce(
      new DOMException("The operation was aborted.", "AbortError"),
    );

    const response = await POST(createPostRequest({ target: "1706.03762" }) as NextRequest);

    await expect(response.json()).resolves.toEqual({
      error: "arXiv request timed out. Try again later.",
    });
    expect(response.status).toBe(504);
  });

  it("maps upstream rate limits to 429 without exposing upstream details", async () => {
    vi.mocked(ingestArxivInline).mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status 429: Too Many Requests"), {
        status: 429,
      }),
    );

    const response = await POST(createPostRequest({ target: "1706.03762" }) as NextRequest);

    await expect(response.json()).resolves.toEqual({
      error: "arXiv is rate limiting requests. Try again later.",
    });
    expect(response.status).toBe(429);
  });
});
