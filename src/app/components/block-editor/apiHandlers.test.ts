import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeApiCommand, type ApiHandlerContext } from "./apiHandlers";
import type { Block } from "./types";

function createContext(onInsertBlocks: (blocks: Block[], insertIndex?: number) => void): ApiHandlerContext {
  return {
    paperId: "paper-1",
    blockIndex: 3,
    onInsertBlocks,
  };
}

describe("executeApiCommand", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("inserts a status block for unavailable commands", async () => {
    const onInsertBlocks = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await executeApiCommand("compare", createContext(onInsertBlocks));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onInsertBlocks).toHaveBeenCalledTimes(1);

    const [blocks, insertIndex] = onInsertBlocks.mock.calls[0] as [Block[], number];
    expect(insertIndex).toBe(3);
    expect(blocks[0]?.type).toBe("paragraph");
    expect(blocks[0]?.content).toContain("/compare command is not available yet");
  });

  it("uses a generic fallback message for unknown commands", async () => {
    const onInsertBlocks = vi.fn();

    await executeApiCommand("not-a-command", createContext(onInsertBlocks));

    expect(onInsertBlocks).toHaveBeenCalledTimes(1);
    const [blocks] = onInsertBlocks.mock.calls[0] as [Block[]];
    expect(blocks[0]?.content).toContain("This command is not available in this editor yet.");
  });
});
