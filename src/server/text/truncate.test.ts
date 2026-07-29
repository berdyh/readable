import { describe, expect, it } from "vitest";

import { truncateSafely, truncateWithEllipsis } from "./index";

// U+1D441 MATHEMATICAL ITALIC CAPITAL N — two UTF-16 code units, and the exact
// character that appears in the ingested Attention Is All You Need chunks.
const MATH_N = "\u{1D441}";

describe("truncateSafely", () => {
  it("leaves text that already fits untouched", () => {
    expect(truncateSafely("short", 20)).toBe("short");
  });

  it("never ends on a lone high surrogate", () => {
    const text = `abc${MATH_N}def`;
    // 4 would land exactly between the two halves of the surrogate pair.
    const cut = truncateSafely(text, 4);
    expect(cut).toBe("abc");
    expect(/[\uD800-\uDBFF]$/.test(cut)).toBe(false);
  });

  it("keeps a surrogate pair whole when it fits", () => {
    expect(truncateSafely(`ab${MATH_N}`, 4)).toBe(`ab${MATH_N}`);
  });

  it("survives JSON round-tripping after a mid-pair cut", () => {
    // The actual failure: JSON.stringify emits a lone surrogate as \udXXX,
    // which is valid JSON syntax but decodes to invalid UTF-8 downstream.
    const cut = truncateSafely(`abc${MATH_N}def`, 4);
    expect(JSON.stringify(cut)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });

  it("returns empty for a non-positive limit", () => {
    expect(truncateSafely("abc", 0)).toBe("");
  });
});

describe("truncateWithEllipsis", () => {
  it("stays within the limit including the ellipsis", () => {
    const out = truncateWithEllipsis("abcdefghij", 5);
    expect(out).toBe("abcd…");
    expect(out.length).toBe(5);
  });

  it("does not split a surrogate pair before the ellipsis", () => {
    const out = truncateWithEllipsis(`abc${MATH_N}def`, 5);
    expect(/[\uD800-\uDBFF]…$/.test(out)).toBe(false);
    expect(JSON.stringify(out)).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i);
  });
});
