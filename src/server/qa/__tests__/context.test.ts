import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `loadQuestionEvidence` is the evidence-gathering half of QA. It was
 * rewritten from live enrichment (arXiv + Semantic Scholar on the hot
 * path) to Postgres-only reads, and every failure mode it has left is a
 * wrong value rather than an error: the answer still comes back, just
 * grounded in the wrong passages or routed on a metadata field that got
 * mapped from the wrong source.
 *
 * The sharpest of those is `citationCount`. This module holds two
 * different numbers by that name — the stored Semantic Scholar count and
 * the in-context occurrence tally used only for ranking — and the router's
 * obscurity trigger reads the first. Confusing them is invisible here and
 * changes what gets retrieved downstream, so the assertions below run the
 * mapped candidate through the real router rather than eyeballing a field.
 */

vi.mock("@/server/db", () => ({
  fetchPaperCitationsByPaperId: vi.fn(),
  fetchPaperFiguresByPaperId: vi.fn(),
}));

vi.mock("@/server/search", () => ({
  hybridPaperChunkSearch: vi.fn(),
}));

import { fetchPaperCitationsByPaperId, fetchPaperFiguresByPaperId } from "@/server/db";
import type { Citation, Figure } from "@/server/db";
import { OBSCURE_CITATION_COUNT_THRESHOLD } from "@/server/explain/constants";
import { isObscureOrRecent } from "@/server/explain/citationRouter";
import { hybridPaperChunkSearch, type HybridPaperChunkHit } from "@/server/search";

import { loadQuestionEvidence, normalizeSelection } from "../context";

const PAPER_ID = "1706.03762";

function hit(overrides: Partial<HybridPaperChunkHit> = {}): HybridPaperChunkHit {
  return {
    id: "uuid-1",
    paperId: PAPER_ID,
    chunkId: "chunk-1",
    text: "Self-attention replaces recurrence.",
    ...overrides,
  };
}

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    paperId: PAPER_ID,
    citationId: "bib.bib1",
    ...overrides,
  };
}

function figure(overrides: Partial<Figure> = {}): Figure {
  return {
    paperId: PAPER_ID,
    figureId: "fig1",
    caption: "Model architecture.",
    ...overrides,
  } as Figure;
}

function mockSearch(hits: HybridPaperChunkHit[], expandedWindow: HybridPaperChunkHit[] = []): void {
  vi.mocked(hybridPaperChunkSearch).mockResolvedValue({
    hits,
    expandedWindow,
    retrieval: {
      vector: { status: "ok", hitCount: hits.length },
      text: { status: "ok", hitCount: hits.length },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearch([]);
  vi.mocked(fetchPaperCitationsByPaperId).mockResolvedValue([]);
  vi.mocked(fetchPaperFiguresByPaperId).mockResolvedValue([]);
});

describe("citation context — the router's obscurity signal", () => {
  it("carries the stored citation count, not the number of chunks that cite the work", async () => {
    // Three retrieved chunks cite the same well-known paper. The stored
    // count is 90000; the in-context tally is 3. Emitting the tally would
    // put every citation below the obscurity threshold and make the router
    // retrieve for all of them; emitting the stored count routes correctly.
    mockSearch([
      hit({ id: "u1", chunkId: "c1", citations: ["bib.bib1"] }),
      hit({ id: "u2", chunkId: "c2", citations: ["bib.bib1"] }),
      hit({ id: "u3", chunkId: "c3", citations: ["bib.bib1"] }),
    ]);
    vi.mocked(fetchPaperCitationsByPaperId).mockResolvedValue([
      citation({ citationId: "bib.bib1", title: "ImageNet", citationCount: 90_000 }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.citations).toHaveLength(1);
    expect(evidence.citations[0].citationCount).toBe(90_000);
    expect(isObscureOrRecent(evidence.citations[0])).toBe(false);
  });

  it("keeps a genuinely little-cited work below the threshold", async () => {
    mockSearch([hit({ citations: ["bib.bib1"] })]);
    vi.mocked(fetchPaperCitationsByPaperId).mockResolvedValue([
      citation({
        citationId: "bib.bib1",
        citationCount: OBSCURE_CITATION_COUNT_THRESHOLD - 1,
      }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.citations[0].citationCount).toBe(OBSCURE_CITATION_COUNT_THRESHOLD - 1);
    expect(isObscureOrRecent(evidence.citations[0])).toBe(true);
  });

  it("leaves an unenriched count absent rather than defaulting it to zero", async () => {
    // A row that ingest never enriched, and a citation id with no row at
    // all. Both must come through as `undefined`: defaulting either to 0
    // would read as "cited zero times", i.e. maximally obscure, and would
    // fire retrieval on every citation of every paper we failed to enrich.
    mockSearch([hit({ citations: ["bib.bib1", "bib.bib9"] })]);
    vi.mocked(fetchPaperCitationsByPaperId).mockResolvedValue([
      citation({ citationId: "bib.bib1", title: "Never enriched" }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    const byId = new Map(evidence.citations.map((entry) => [entry.citationId, entry]));
    expect(byId.get("bib.bib1")?.citationCount).toBeUndefined();
    expect(byId.get("bib.bib9")?.citationCount).toBeUndefined();
    expect(isObscureOrRecent(byId.get("bib.bib1")!)).toBe(false);
    expect(isObscureOrRecent(byId.get("bib.bib9")!)).toBe(false);
  });

  it("carries the rest of the router's metadata through unchanged", async () => {
    mockSearch([hit({ citations: ["bib.bib1"] })]);
    vi.mocked(fetchPaperCitationsByPaperId).mockResolvedValue([
      citation({
        citationId: "bib.bib1",
        title: "Attention Is All You Need",
        authors: ["Vaswani"],
        year: 2017,
        doi: "10.1/xyz",
        arxivId: "1706.03762",
        abstract: "We propose the Transformer.",
        citationCount: 120_000,
      }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.citations[0]).toEqual({
      citationId: "bib.bib1",
      title: "Attention Is All You Need",
      authors: ["Vaswani"],
      year: 2017,
      source: undefined,
      doi: "10.1/xyz",
      url: undefined,
      arxivId: "1706.03762",
      abstract: "We propose the Transformer.",
      citationCount: 120_000,
    });
  });

  it("falls back to venue for the source label and to the open-access pdf for the url", async () => {
    mockSearch([hit({ citations: ["bib.bib1", "bib.bib2"] })]);
    vi.mocked(fetchPaperCitationsByPaperId).mockResolvedValue([
      citation({
        citationId: "bib.bib1",
        venue: "NeurIPS",
        openAccessPdfUrl: "https://example.org/oa.pdf",
      }),
      citation({
        citationId: "bib.bib2",
        source: "arXiv",
        venue: "NeurIPS",
        url: "https://example.org/canonical",
        openAccessPdfUrl: "https://example.org/oa.pdf",
      }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");
    const byId = new Map(evidence.citations.map((entry) => [entry.citationId, entry]));

    expect(byId.get("bib.bib1")?.source).toBe("NeurIPS");
    expect(byId.get("bib.bib1")?.url).toBe("https://example.org/oa.pdf");
    // The fallbacks must not win when the primary field is populated.
    expect(byId.get("bib.bib2")?.source).toBe("arXiv");
    expect(byId.get("bib.bib2")?.url).toBe("https://example.org/canonical");
  });
});

describe("citation context — which citations reach the router", () => {
  it("keeps the most-cited works when more citations appear than fit the context", async () => {
    // Four slots. Ranked by how many retrieved chunks reference each work,
    // so a reversed comparator would hand the router the four citations the
    // retrieved text leans on least.
    mockSearch([
      hit({ id: "u1", chunkId: "c1", citations: ["bib.bib5", "bib.bib4", "bib.bib3"] }),
      hit({ id: "u2", chunkId: "c2", citations: ["bib.bib5", "bib.bib4", "bib.bib3"] }),
      hit({ id: "u3", chunkId: "c3", citations: ["bib.bib5", "bib.bib4", "bib.bib2"] }),
      hit({ id: "u4", chunkId: "c4", citations: ["bib.bib5", "bib.bib1"] }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.citations.map((entry) => entry.citationId)).toEqual([
      "bib.bib5", // 4 chunks
      "bib.bib4", // 3
      "bib.bib3", // 2
      "bib.bib2", // 1, ahead of bib.bib1 on insertion order
    ]);
  });

  it("counts citations from the expanded page window, not only the top hits", async () => {
    // The window exists so a passage's neighbours can ground the answer.
    // A citation that only appears there is still cited by text the model
    // will see, so it has to reach the router.
    mockSearch(
      [hit({ id: "u1", chunkId: "c1", citations: ["bib.bib1"] })],
      [hit({ id: "u2", chunkId: "c2", citations: ["bib.bib2", "bib.bib1"] })],
    );

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.citations.map((entry) => entry.citationId)).toEqual(["bib.bib1", "bib.bib2"]);
  });

  it("resolves whitespace-padded ids to the stored row and drops blank ones", async () => {
    mockSearch([hit({ citations: [" bib.bib1 ", "bib.bib1", "  ", ""] })]);
    vi.mocked(fetchPaperCitationsByPaperId).mockResolvedValue([
      citation({ citationId: "bib.bib1", title: "ImageNet", citationCount: 90_000 }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    // Untrimmed, the padded id would be its own candidate that matches no
    // stored row — an un-enriched duplicate the router could never place.
    expect(evidence.citations).toHaveLength(1);
    expect(evidence.citations[0].citationId).toBe("bib.bib1");
    expect(evidence.citations[0].citationCount).toBe(90_000);
  });

  it("does not read the citation table when no retrieved chunk cites anything", async () => {
    mockSearch([hit({ citations: [] }), hit({ id: "u2", chunkId: "c2" })]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.citations).toEqual([]);
    expect(fetchPaperCitationsByPaperId).not.toHaveBeenCalled();
  });
});

describe("figure context", () => {
  it("returns each referenced figure once and drops ids with no stored figure", async () => {
    mockSearch(
      [hit({ id: "u1", chunkId: "c1", figureIds: ["fig1", "fig1", "fig-missing"] })],
      [hit({ id: "u2", chunkId: "c2", figureIds: ["fig2", "fig1"] })],
    );
    vi.mocked(fetchPaperFiguresByPaperId).mockResolvedValue([
      figure({ figureId: "fig1", caption: "Architecture.", pageNumber: 3 }),
      figure({ figureId: "fig2", caption: "Attention heads." }),
      figure({ figureId: "fig3", caption: "Never referenced." }),
    ]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    // A phantom entry for "fig-missing" would render as a figure with no
    // caption and no image; an unreferenced figure would pad the prompt.
    expect(evidence.figures.map((entry) => entry.figureId)).toEqual(["fig1", "fig2"]);
    expect(evidence.figures[0].caption).toBe("Architecture.");
    expect(evidence.figures[0].pageNumber).toBe(3);
  });

  it("does not read the figure table when no retrieved chunk references one", async () => {
    mockSearch([hit({ figureIds: [] })]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.figures).toEqual([]);
    expect(fetchPaperFiguresByPaperId).not.toHaveBeenCalled();
  });
});

describe("chunk mapping", () => {
  it("normalizes absent citation and figure arrays to empty ones", async () => {
    mockSearch([hit()]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.hits[0].citations).toEqual([]);
    expect(evidence.hits[0].figureIds).toEqual([]);
  });

  it("copies the arrays instead of aliasing the search hit's", async () => {
    const source = hit({ citations: ["bib.bib1"], figureIds: ["fig1"] });
    mockSearch([source]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");
    evidence.hits[0].citations.push("bib.bib2");
    evidence.hits[0].figureIds.push("fig2");

    expect(source.citations).toEqual(["bib.bib1"]);
    expect(source.figureIds).toEqual(["fig1"]);
  });

  it("keeps hits and the expanded window separable in the returned context", async () => {
    mockSearch(
      [hit({ id: "u1", chunkId: "c1", score: 0.9, pageNumber: 2, section: "Method" })],
      [hit({ id: "u2", chunkId: "c2", pageNumber: 3 })],
    );

    const evidence = await loadQuestionEvidence(PAPER_ID, "what is attention?");

    expect(evidence.hits.map((chunk) => chunk.chunkId)).toEqual(["c1"]);
    expect(evidence.expandedWindow.map((chunk) => chunk.chunkId)).toEqual(["c2"]);
    expect(evidence.hits[0]).toMatchObject({ score: 0.9, pageNumber: 2, section: "Method" });
    expect(evidence.paperId).toBe(PAPER_ID);
    expect(evidence.retrieval).toEqual({
      vector: { status: "ok", hitCount: 1 },
      text: { status: "ok", hitCount: 1 },
    });
  });
});

describe("normalizeSelection", () => {
  it("drops a selection that carries nothing usable", () => {
    expect(normalizeSelection(undefined)).toBeUndefined();
    expect(normalizeSelection({})).toBeUndefined();
    expect(normalizeSelection({ text: "   ", section: "  " })).toBeUndefined();
  });

  it("keeps a page of zero, which is a real page index and not an absent one", () => {
    // `||`-style falsiness here would silently drop page 0.
    expect(normalizeSelection({ page: 0 })).toEqual({
      text: undefined,
      section: undefined,
      page: 0,
    });
  });

  it("rejects a non-finite page rather than passing NaN downstream", () => {
    expect(normalizeSelection({ text: "attention", page: Number.NaN })?.page).toBeUndefined();
    expect(normalizeSelection({ text: "attention", page: Number.POSITIVE_INFINITY })?.page).toBe(
      undefined,
    );
  });

  it("trims text and section and drops the blank ones", () => {
    expect(normalizeSelection({ text: "  attention  ", section: "   ", page: 4 })).toEqual({
      text: "attention",
      section: undefined,
      page: 4,
    });
  });
});

describe("query construction", () => {
  it("appends the selected text to the question so retrieval is scoped to it", async () => {
    mockSearch([]);

    const evidence = await loadQuestionEvidence(PAPER_ID, "  why does this work?  ", {
      selection: { text: "  multi-head attention  ", section: "Method", page: 3 },
    });

    // Section and page are context for the answer, not search terms —
    // folding them into the query would bias retrieval toward chunks that
    // merely mention the section's name.
    expect(evidence.query).toBe("why does this work? multi-head attention");
    expect(vi.mocked(hybridPaperChunkSearch).mock.calls[0][0]).toMatchObject({
      paperId: PAPER_ID,
      query: "why does this work? multi-head attention",
    });
  });

  it("searches on the question alone when the selection carries no text", async () => {
    const evidence = await loadQuestionEvidence(PAPER_ID, "why does this work?", {
      selection: { section: "Method", page: 3 },
    });

    expect(evidence.query).toBe("why does this work?");
    expect(evidence.selection).toEqual({ text: undefined, section: "Method", page: 3 });
  });

  it("passes the retrieval defaults through and lets the caller override them", async () => {
    await loadQuestionEvidence(PAPER_ID, "why does this work?");
    expect(vi.mocked(hybridPaperChunkSearch).mock.calls[0][0]).toEqual({
      paperId: PAPER_ID,
      query: "why does this work?",
      limit: 8,
      alpha: 0.65,
      pageWindow: 1,
    });

    await loadQuestionEvidence(PAPER_ID, "why does this work?", { limit: 3, alpha: 0.1 });
    expect(vi.mocked(hybridPaperChunkSearch).mock.calls[1][0]).toMatchObject({
      limit: 3,
      alpha: 0.1,
    });
  });

  it("refuses a blank question before spending a retrieval round trip", async () => {
    await expect(loadQuestionEvidence(PAPER_ID, "   ")).rejects.toThrow(
      "Question text is required.",
    );
    expect(hybridPaperChunkSearch).not.toHaveBeenCalled();
  });
});
