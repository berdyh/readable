import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Figure, PaperChunk, PaperRecord } from "@/server/db";

const mocks = vi.hoisted(() => ({
  fetchPaperChunksByPaperId: vi.fn<(paperId: string) => Promise<PaperChunk[]>>(),
  fetchPaperFiguresByPaperId: vi.fn<(paperId: string) => Promise<Figure[]>>(),
  getPaper: vi.fn<(paperId: string) => Promise<PaperRecord | undefined>>(),
  fetchArxivMetadata: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  fetchPaperChunksByPaperId: mocks.fetchPaperChunksByPaperId,
  fetchPaperFiguresByPaperId: mocks.fetchPaperFiguresByPaperId,
  getPaper: mocks.getPaper,
}));

vi.mock("@/server/ingest", () => ({
  fetchArxivMetadata: mocks.fetchArxivMetadata,
}));

import { loadPaperSummaryContext } from "./context";

const PAPER_ID = "2401.00001";

const chunk = (
  chunkId: string,
  section: string,
  text: string,
  extra: Partial<PaperChunk> = {},
): PaperChunk => ({
  paperId: PAPER_ID,
  chunkId,
  text,
  section,
  ...extra,
});

describe("loadPaperSummaryContext", () => {
  beforeEach(() => {
    mocks.fetchPaperFiguresByPaperId.mockResolvedValue([]);
    mocks.getPaper.mockResolvedValue(undefined);
    mocks.fetchArxivMetadata.mockResolvedValue(undefined);
  });

  it("includes every paragraph when the budget is not binding", async () => {
    mocks.fetchPaperChunksByPaperId.mockResolvedValue([
      chunk("S1-p1", "Introduction", "intro lead"),
      chunk("S1-p2", "Introduction", "intro detail"),
      chunk("S2-p1", "Results", "results lead"),
    ]);

    const context = await loadPaperSummaryContext(PAPER_ID, { charBudget: 10_000 });

    expect(context.sections.map((section) => section.paragraphs)).toEqual([
      ["intro lead", "intro detail"],
      ["results lead"],
    ]);
    expect(context.coverage.truncated).toBe(false);
    expect(context.coverage.truncationNote).toBeUndefined();
    expect(context.coverage.totalParagraphs).toBe(3);
    expect(context.coverage.includedParagraphs).toBe(3);
  });

  it("keeps every section's lead paragraph and deepens longest-first under a binding budget", async () => {
    const long = "L".repeat(300);
    const medium = "M".repeat(120);
    const short = "s".repeat(30);

    mocks.fetchPaperChunksByPaperId.mockResolvedValue([
      chunk("S1-p1", "Introduction", "intro lead"),
      chunk("S1-p2", "Introduction", short),
      chunk("S1-p3", "Introduction", long),
      chunk("S2-p1", "Conclusion", "conclusion lead"),
      chunk("S2-p2", "Conclusion", medium),
    ]);

    // Budget covers the two leads (~25 chars) + the 300-char paragraph,
    // but not also the 120-char one.
    const context = await loadPaperSummaryContext(PAPER_ID, { charBudget: 380 });

    const [intro, conclusion] = context.sections;
    // Coverage round: both leads survive even under a binding budget.
    expect(intro.paragraphs[0]).toBe("intro lead");
    expect(conclusion.paragraphs[0]).toBe("conclusion lead");
    // Deepening round: longest remaining paragraph won the budget.
    expect(intro.paragraphs).toContain(long);
    expect(conclusion.paragraphs).not.toContain(medium);
    expect(context.coverage.truncated).toBe(true);
    expect(context.coverage.truncationNote).toMatch(/truncated/i);
  });

  it("re-emits deepened paragraphs in document order within their section", async () => {
    const long = "L".repeat(200);
    mocks.fetchPaperChunksByPaperId.mockResolvedValue([
      chunk("S1-p1", "Method", "lead"),
      chunk("S1-p2", "Method", "second"),
      chunk("S1-p3", "Method", long),
    ]);

    const context = await loadPaperSummaryContext(PAPER_ID, { charBudget: 10_000 });

    expect(context.sections[0].paragraphs).toEqual(["lead", "second", long]);
  });

  it("prefers stored paper metadata and never calls arXiv when it is complete", async () => {
    mocks.fetchPaperChunksByPaperId.mockResolvedValue([chunk("S1-p1", "Intro", "text")]);
    mocks.getPaper.mockResolvedValue({
      paperId: PAPER_ID,
      title: "Stored Title",
      abstract: "Stored abstract",
      authors: ["A. Author"],
      categories: [],
    });

    const context = await loadPaperSummaryContext(PAPER_ID);

    expect(context.metadata?.title).toBe("Stored Title");
    expect(mocks.fetchArxivMetadata).not.toHaveBeenCalled();
  });

  it("falls back to arXiv only for fields missing from the papers row", async () => {
    mocks.fetchPaperChunksByPaperId.mockResolvedValue([chunk("S1-p1", "Intro", "text")]);
    mocks.getPaper.mockResolvedValue({
      paperId: PAPER_ID,
      title: "Stored Title",
      authors: [],
      categories: [],
    });
    mocks.fetchArxivMetadata.mockResolvedValue({
      id: PAPER_ID,
      title: "Fetched Title",
      abstract: "Fetched abstract",
      authors: ["B. Author"],
      categories: [],
    });

    const context = await loadPaperSummaryContext(PAPER_ID);

    expect(context.metadata?.title).toBe("Stored Title");
    expect(context.metadata?.abstract).toBe("Fetched abstract");
    expect(context.metadata?.authors).toEqual(["B. Author"]);
  });

  it("builds figure contexts without duplicated section paragraphs", async () => {
    mocks.fetchPaperChunksByPaperId.mockResolvedValue([
      chunk("S1-p1", "Results", "figure-discussing text", { figureIds: ["fig1"] }),
    ]);
    mocks.fetchPaperFiguresByPaperId.mockResolvedValue([
      { paperId: PAPER_ID, figureId: "fig1", caption: "The caption", pageNumber: 3 },
    ]);

    const context = await loadPaperSummaryContext(PAPER_ID);

    expect(context.figures).toEqual([
      {
        id: "fig1",
        caption: "The caption",
        pageNumber: 3,
        referencedSectionIds: ["S1"],
      },
    ]);
    // No supportingParagraphs field any more — that block was 100%
    // duplicated section text.
    expect(Object.keys(context.figures[0])).not.toContain("supportingParagraphs");
  });

  it("surfaces sections in stored (document) order", async () => {
    mocks.fetchPaperChunksByPaperId.mockResolvedValue([
      chunk("S1-p1", "Introduction", "a", { tokenStart: 0 }),
      chunk("S2-p1", "Training", "b", { tokenStart: 1 }),
      chunk("S3-p1", "Conclusion", "c", { tokenStart: 2 }),
    ]);

    const context = await loadPaperSummaryContext(PAPER_ID);

    expect(context.sections.map((section) => section.title)).toEqual([
      "Introduction",
      "Training",
      "Conclusion",
    ]);
  });
});
