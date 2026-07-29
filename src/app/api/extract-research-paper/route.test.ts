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

// One factory per module path: repeated vi.mock() calls on the same specifier
// replace each other rather than merging.
vi.mock("@/server/ingest", () => ({
  getIngestEnvironment: vi.fn(),
  runDeepSeekOcr: vi.fn(),
  extractPdfText: vi.fn(),
  shouldUseOcr: vi.fn(),
}));

import {
  AUTH_REQUIRED_MESSAGE,
  AuthenticationRequiredError,
  requireAuthenticatedUserId,
} from "@/server/auth";
import { getIngestEnvironment } from "@/server/ingest";
import { runDeepSeekOcr } from "@/server/ingest";
import { extractPdfText, shouldUseOcr } from "@/server/ingest";
import type { PdfExtractionResult } from "@/server/ingest/types";

import { POST } from "./route";

function createPostRequest(): Request {
  const formData = new FormData();
  formData.set("pdf", new File(["%PDF-1.4"], "paper.pdf", { type: "application/pdf" }));

  return new Request("http://localhost/api/extract-research-paper", {
    method: "POST",
    body: formData,
  });
}

const pdfExtraction: PdfExtractionResult = {
  pages: [
    {
      pageNumber: 1,
      text: "Extracted text",
      figures: [],
      tables: [],
      images: [],
    },
  ],
  combinedText: "Extracted text",
  figures: [],
  tables: [],
  images: [],
  analysis: {
    sampledPages: 1,
    sampledTextLength: 14,
    sampledImageCount: 0,
    avgTextPerPage: 14,
    avgImagesPerPage: 0,
    isLikelyScanned: false,
    recommendedTool: "pdfjs-dist",
    confidence: "high",
  },
};

describe("/api/extract-research-paper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAuthenticatedUserId).mockResolvedValue("user_123");
    vi.mocked(getIngestEnvironment).mockReturnValue({
      arxivApiBaseUrl: "https://export.arxiv.org/api/query",
      ar5ivBaseUrl: "https://ar5iv.org/html",
      fetchTimeoutMs: 20_000,
      pdfFetchTimeoutMs: 20_000,
      ocrTimeoutMs: 90_000,
      enableOcrFallback: true,
    });
    vi.mocked(extractPdfText).mockResolvedValue(pdfExtraction);
    vi.mocked(shouldUseOcr).mockReturnValue(false);
  });

  it("returns 401 before PDF or OCR extraction when authentication is required", async () => {
    vi.mocked(requireAuthenticatedUserId).mockRejectedValue(new AuthenticationRequiredError());
    const request = {
      formData: vi.fn().mockRejectedValue(new Error("body should not be parsed")),
    } as unknown as NextRequest;

    const response = await POST(request);

    await expect(response.json()).resolves.toEqual({
      error: AUTH_REQUIRED_MESSAGE,
    });
    expect(response.status).toBe(401);
    expect(request.formData).not.toHaveBeenCalled();
    expect(extractPdfText).not.toHaveBeenCalled();
    expect(runDeepSeekOcr).not.toHaveBeenCalled();
  });

  it("extracts PDF content for a signed-in request", async () => {
    const response = await POST(createPostRequest() as NextRequest);

    await expect(response.json()).resolves.toMatchObject({
      method: "pdfjs-dist",
      text: ["Extracted text"],
      stats: {
        pages: 1,
        combinedTextLength: 14,
        ocrAttempted: false,
      },
    });
    expect(response.status).toBe(200);
    expect(requireAuthenticatedUserId).toHaveBeenCalledTimes(1);
    expect(extractPdfText).toHaveBeenCalledTimes(1);
    expect(runDeepSeekOcr).not.toHaveBeenCalled();
  });
});
