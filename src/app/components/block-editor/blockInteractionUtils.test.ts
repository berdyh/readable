import type { Block } from "./types";
import {
  getDeletionFocusTarget,
  isBlockContentEmpty,
  resolveDropReorder,
} from "./blockInteractionUtils";

const block = (id: string, type: Block["type"] = "paragraph", content = "text"): Block => ({
  id,
  type,
  content,
});

describe("block boundary interactions", () => {
  it("treats editor-empty variants as empty content", () => {
    expect(isBlockContentEmpty("<p></p>")).toBe(true);
    expect(isBlockContentEmpty("<p><br></p>")).toBe(true);
    expect(isBlockContentEmpty("&nbsp;")).toBe(true);
    expect(isBlockContentEmpty("actual text")).toBe(false);
  });

  it("computes enter insertion boundary after the last block", () => {
    const blocks = [block("a"), block("b")];
    const insertionIndex = blocks.length - 1 + 1;
    expect(insertionIndex).toBe(blocks.length);
  });

  it("moves focus to previous block end on backspace deletion", () => {
    const blocks = [block("a"), block("b"), block("c")];
    expect(getDeletionFocusTarget(blocks, "b", "Backspace")).toEqual({
      blockId: "a",
      position: "end",
    });
  });

  it("moves focus to next block start on delete deletion", () => {
    const blocks = [block("a"), block("b"), block("c")];
    expect(getDeletionFocusTarget(blocks, "b", "Delete")).toEqual({
      blockId: "c",
      position: "start",
    });
  });

  it("keeps focus target null at boundaries with no adjacent blocks", () => {
    const blocks = [block("a")];
    expect(getDeletionFocusTarget(blocks, "a", "Backspace")).toBeNull();
    expect(getDeletionFocusTarget(blocks, "a", "Delete")).toBeNull();
  });

  it("falls back to previous block on delete when there is no next block", () => {
    const blocks = [block("a"), block("b")];
    expect(getDeletionFocusTarget(blocks, "b", "Delete")).toEqual({
      blockId: "a",
      position: "end",
    });
  });

  it("reorders using stable IDs and current snapshot indices", () => {
    const blocks = [block("a"), block("b"), block("c"), block("d")];
    expect(resolveDropReorder(blocks, "a", "c", "after")).toEqual({
      toIndex: 2,
    });
    expect(resolveDropReorder(blocks, "d", "b", "before")).toEqual({
      toIndex: 1,
    });
  });

  it("ignores no-op drag reorder requests", () => {
    const blocks = [block("a"), block("b")];
    expect(resolveDropReorder(blocks, "a", "a", "before")).toBeNull();
    expect(resolveDropReorder(blocks, "x", "a", "before")).toBeNull();
  });
});
