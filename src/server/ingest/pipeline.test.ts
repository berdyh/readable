import { describe, expect, it } from "vitest";

import { buildChunks } from "./pipeline";
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
