import { beforeEach, describe, expect, it, vi } from "vitest";

import { executeApiCommand, type ApiHandlerContext } from "./apiHandlers";
import type { Block } from "./types";

function createContext(
  onInsertBlocks: (blocks: Block[], insertIndex?: number) => void,
  overrides: Partial<ApiHandlerContext> = {},
): ApiHandlerContext {
  return {
    paperId: "paper-1",
    blockIndex: 3,
    onInsertBlocks,
    ...overrides,
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

  it("shows inline guidance when /arxiv has no target", async () => {
    const onInsertBlocks = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await executeApiCommand("arxiv", createContext(onInsertBlocks));

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onInsertBlocks).toHaveBeenCalledTimes(1);
    const [blocks] = onInsertBlocks.mock.calls[0] as [Block[]];
    expect(blocks[0]?.content).toContain("needs an arXiv ID, DOI, or URL");
  });

  it("routes /explain to selection summary endpoint", async () => {
    const onInsertBlocks = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        callout: {
          bullets: [{ text: "Key point", citationIds: [] }],
          deeper: [],
          citations: [],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await executeApiCommand(
      "explain",
      createContext(onInsertBlocks, {
        selection: {
          text: "selected text",
          page: 1,
          section: "Introduction",
        },
      }),
    );

    expect(fetchSpy).toHaveBeenCalledWith("/api/editor/selection/summary", expect.any(Object));
    const [, requestInit] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(requestInit.body)).toEqual({
      paperId: "paper-1",
      selection: {
        text: "selected text",
        page: 1,
        section: "Introduction",
      },
    });
    expect(onInsertBlocks).toHaveBeenCalledTimes(1);
  });

  it("omits client user ids from summary requests", async () => {
    const onInsertBlocks = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        paperId: "paper-1",
        abstract: ["Short summary"],
        sections: [],
        keyTakeaways: [],
        citations: [],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await executeApiCommand("summary", createContext(onInsertBlocks));

    expect(fetchSpy).toHaveBeenCalledWith("/api/summarize", expect.any(Object));
    const [, requestInit] = fetchSpy.mock.calls[0] as [string, { body: string }];
    expect(JSON.parse(requestInit.body)).toEqual({ paperId: "paper-1" });
  });
  it("routes /arxiv to ingest endpoint when target is provided", async () => {
    const onInsertBlocks = vi.fn();
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        arxivId: "1234.5678",
        sourceUrl: "https://arxiv.org/abs/1234.5678",
        title: "Test Paper",
        authors: ["Author"],
        sections: [],
        figures: [],
        categories: [],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await executeApiCommand(
      "arxiv",
      createContext(onInsertBlocks, { target: "https://arxiv.org/abs/1234.5678" }),
    );

    expect(fetchSpy).toHaveBeenCalledWith("/api/editor/ingest/arxiv", expect.any(Object));
    expect(onInsertBlocks).toHaveBeenCalledTimes(1);
  });
});
