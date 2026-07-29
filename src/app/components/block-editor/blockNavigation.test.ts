import { describe, expect, it } from "vitest";

import { resolveNavigationTarget } from "./blockNavigation";
import type { Block } from "./types";

function block(id: string, content: string, metadata?: Block["metadata"]): Block {
  return { id, type: "paragraph", content, metadata };
}

describe("resolveNavigationTarget", () => {
  it("prefers an exact chunkId match over every other signal", () => {
    const blocks = [
      block("a", "Attention is all you need", { page: 1 }),
      block("b", "Scaled dot-product attention", { chunkId: "S3-p2", page: 4 }),
    ];

    expect(
      resolveNavigationTarget(blocks, { chunkId: "S3-p2", page: 1, quote: "Attention is all" })?.id,
    ).toBe("b");
  });

  it("falls back to quote text and strips markup and entities", () => {
    const blocks = [
      block("a", "<p>Unrelated preamble</p>"),
      block("b", "<p>Encoder <strong>&amp;</strong> decoder stacks</p>"),
    ];

    expect(resolveNavigationTarget(blocks, { quote: "encoder & decoder stacks" })?.id).toBe("b");
  });

  it("falls back to the nearest page within tolerance, then to the next page forward", () => {
    const blocks = [block("a", "one", { page: 2 }), block("b", "two", { page: 9 })];

    expect(resolveNavigationTarget(blocks, { page: 3 })?.id).toBe("a");
    expect(resolveNavigationTarget(blocks, { page: 7 })?.id).toBe("b");
  });

  it("never targets divider blocks", () => {
    const blocks: Block[] = [
      { id: "d", type: "divider", content: "match me", metadata: { page: 1 } },
      block("a", "match me", { page: 1 }),
    ];

    expect(resolveNavigationTarget(blocks, { page: 1 })?.id).toBe("a");
  });

  it("returns undefined when nothing matches", () => {
    const blocks = [block("a", "one", { page: 1 })];

    expect(resolveNavigationTarget(blocks, { chunkId: "nope" })).toBeUndefined();
    expect(resolveNavigationTarget(blocks, {})).toBeUndefined();
  });
});
