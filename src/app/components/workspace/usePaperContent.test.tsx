import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SummaryResult } from "@/server/summarize/types";

const clerk = vi.hoisted(() => ({
  useUser: vi.fn(() => ({ isLoaded: true, isSignedIn: true })),
}));

vi.mock("@clerk/nextjs", () => ({
  useUser: clerk.useUser,
}));

import { usePaperContent } from "./usePaperContent";

const PAPER_ID = "arxiv:1706.03762";

const contractSummary: SummaryResult = {
  sections: [
    {
      section_id: "S1",
      title: "Introduction",
      summary: "Claim.",
      reasoning: "Mechanism.",
      hook: "Why?",
      source: "model_knowledge",
    },
    { section_id: "S2", title: "Method", summary: "Claim.", reasoning: "Mechanism." },
    { section_id: "S3", title: "Results", summary: "Claim.", reasoning: "Mechanism." },
  ],
  key_findings: [],
  figures: [],
  concepts: [{ concept: "attention mechanism", domain: "ml" }],
};

const htmlResult = {
  arxivId: "1706.03762",
  title: "Attention Is All You Need",
  sections: [{ id: "S1", title: "Introduction", level: 1, paragraphs: ["Paper HTML text."] }],
  figures: [],
  sourceUrl: "https://arxiv.org/abs/1706.03762",
};

const fetchMock = vi.fn();

function stubFetch() {
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/editor/ingest/arxiv")) {
      return new Response(JSON.stringify(htmlResult), { status: 200 });
    }
    if (url.includes("/api/summarize")) {
      return new Response(JSON.stringify(contractSummary), { status: 200 });
    }
    if (url.includes("/api/persona/exposure")) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
}

const exposureCalls = () =>
  fetchMock.mock.calls.filter(([input]) => String(input).includes("/api/persona/exposure"));

beforeEach(() => {
  fetchMock.mockReset();
  stubFetch();
  vi.stubGlobal("fetch", fetchMock);
  clerk.useUser.mockReturnValue({ isLoaded: true, isSignedIn: true });
});

describe("usePaperContent pass-aware rendering", () => {
  it("renders the explanation contract as primary content on pass 1 (skim)", async () => {
    const { result } = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "skim" }));

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    const contents = result.current.initialBlocks.map((block) => block.content);
    expect(contents).toContain("Paper Summary");
    expect(contents).not.toContain("Paper HTML text.");
    expect(result.current.documentKey).toBe(`${PAPER_ID}:summary`);
  });

  it("keeps paper HTML primary on passes 2-3", async () => {
    const { result } = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "read" }));

    await waitFor(() => {
      expect(result.current.arxivHtmlContent).not.toBeNull();
      expect(result.current.summary).not.toBeNull();
    });

    const contents = result.current.initialBlocks.map((block) => block.content);
    expect(contents).toContain("Paper HTML text.");
    expect(contents).not.toContain("Paper Summary");
    expect(result.current.documentKey).toBe(`${PAPER_ID}:paper`);
  });

  it("records exposure once when contract content actually renders", async () => {
    const { result } = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "skim" }));

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    await waitFor(() => {
      expect(exposureCalls()).toHaveLength(1);
    });

    const [, init] = exposureCalls()[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      paperId: PAPER_ID,
      concepts: [{ concept: "attention mechanism", domain: "ml" }],
    });
  });

  it("never records exposure when the summary is not the rendered surface", async () => {
    const { result } = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "deep" }));

    await waitFor(() => {
      expect(result.current.summary).not.toBeNull();
    });

    expect(exposureCalls()).toHaveLength(0);
  });

  it("never records exposure for anonymous readers", async () => {
    clerk.useUser.mockReturnValue({ isLoaded: true, isSignedIn: false });

    const { result } = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "skim" }));

    await waitFor(() => {
      expect(result.current.arxivHtmlContent).not.toBeNull();
    });

    expect(exposureCalls()).toHaveLength(0);
    // Anonymous readers still get the paper text.
    const contents = result.current.initialBlocks.map((block) => block.content);
    expect(contents).toContain("Paper HTML text.");
  });
});

/**
 * `documentKey` names the source document the blocks were parsed from. The
 * editor remembers reader edits under it, so two different documents must never
 * share a key — and a placeholder must never share one with real content, or an
 * edited placeholder would keep the real thing off the screen forever.
 */
describe("usePaperContent document keys", () => {
  it("keys the summary and the paper as different documents", async () => {
    const skim = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "skim" }));
    await waitFor(() => {
      expect(skim.result.current.summary).not.toBeNull();
    });

    const read = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "read" }));
    await waitFor(() => {
      expect(read.result.current.arxivHtmlContent).not.toBeNull();
    });

    expect(skim.result.current.documentKey).toBe(`${PAPER_ID}:summary`);
    expect(read.result.current.documentKey).toBe(`${PAPER_ID}:paper`);
  });

  it("keys a loading placeholder apart from both real documents", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/api/editor/ingest/arxiv")) {
        // Never settles: the reader is looking at the loading placeholder.
        return new Promise<Response>(() => {});
      }
      return new Response(JSON.stringify(contractSummary), { status: 200 });
    });

    const { result } = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "skim" }));
    await waitFor(() => {
      expect(result.current.isHtmlLoading).toBe(true);
    });

    expect(result.current.documentKey).toBe(`${PAPER_ID}:placeholder`);
    expect(result.current.documentKey).not.toBe(`${PAPER_ID}:summary`);
    expect(result.current.documentKey).not.toBe(`${PAPER_ID}:paper`);
  });

  it("keys an error placeholder the same way as any other placeholder", async () => {
    fetchMock.mockImplementation(
      async () => new Response(JSON.stringify({ error: "boom" }), { status: 500 }),
    );

    const { result } = renderHook(() => usePaperContent({ paperId: PAPER_ID, pass: "skim" }));
    await waitFor(() => {
      expect(result.current.summaryError).not.toBeNull();
    });

    expect(result.current.initialBlocks[0].id).toBe("error-placeholder");
    expect(result.current.documentKey).toBe(`${PAPER_ID}:placeholder`);
  });
});
