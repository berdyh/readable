import { describe, expect, it } from "vitest";

import type { Citation } from "@/server/db";
import type { SemanticScholarPaper } from "@/server/external";

import { applyCitationEnrichment, buildChunks } from "./pipeline";
import type { PaperSection } from "./types";

const section = (id: string, title: string, texts: string[]): PaperSection => ({
  id,
  title,
  level: 1,
  paragraphs: texts.map((text, index) => ({
    id: `${id}-p${index + 1}`,
    text,
    citations: [],
    figureIds: [],
  })),
});

describe("buildChunks", () => {
  it("writes a paper-wide reading-order ordinal into tokenStart", () => {
    const sections = [
      section("S1", "Introduction", ["a", "b"]),
      section("S2", "Method", ["c"]),
      section("S10", "Conclusion", ["d", "e"]),
    ];

    const { chunks } = buildChunks("2401.00001", sections);

    expect(chunks.map((chunk) => chunk.tokenStart)).toEqual([0, 1, 2, 3, 4]);
    // The ordinal follows section order as parsed, not chunk_id sort order.
    expect(chunks.map((chunk) => chunk.chunkId)).toEqual([
      "S1-p1",
      "S1-p2",
      "S2-p1",
      "S10-p1",
      "S10-p2",
    ]);
  });
});

describe("applyCitationEnrichment", () => {
  const baseCitation: Citation = {
    paperId: "2401.00001",
    citationId: "bib.bib1",
    title: "Layer normalization",
    year: 2016,
  };

  const ssPaper: SemanticScholarPaper = {
    paperId: "ss-1",
    title: "Layer Normalization",
    abstract: "We propose layer normalization.",
    authors: ["J. Ba", "J. Kiros", "G. Hinton"],
    year: 2016,
    venue: "arXiv",
    doi: "10.1/ln",
    arxivId: "1607.06450",
    url: "https://semanticscholar.org/p/ss-1",
    openAccessPdfUrl: "https://arxiv.org/pdf/1607.06450",
    citationCount: 9000,
  };

  it("fills gaps from enrichment, keeps stored bibliography fields, and stamps enrichedAt", () => {
    const [enriched] = applyCitationEnrichment(
      [baseCitation],
      new Map([["bib.bib1", ssPaper]]),
    );

    // Stored bibliography title wins over the S2 one.
    expect(enriched.title).toBe("Layer normalization");
    expect(enriched.abstract).toBe("We propose layer normalization.");
    expect(enriched.venue).toBe("arXiv");
    expect(enriched.citationCount).toBe(9000);
    expect(enriched.arxivId).toBe("1607.06450");
    expect(enriched.openAccessPdfUrl).toBe("https://arxiv.org/pdf/1607.06450");
    expect(enriched.enrichedAt).toBeTruthy();
  });

  it("leaves citations untouched when enrichment has no hit (S2 down)", () => {
    const [untouched] = applyCitationEnrichment([baseCitation], new Map());

    expect(untouched).toEqual(baseCitation);
    expect(untouched.enrichedAt).toBeUndefined();
  });
});
