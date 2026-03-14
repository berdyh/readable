import { describe, expect, it, vi } from "vitest";

import { buildSlashCommandItems, type SlashCommandContext } from "./commands";

function makeContext(overrides: Partial<SlashCommandContext> = {}): SlashCommandContext {
  return {
    blockId: "block-1",
    blockIndex: 0,
    blockType: "paragraph",
    currentContent: "Selected block text",
    paperId: "paper-1",
    ...overrides,
  };
}

describe("slash command API parameter mapping", () => {
  it("maps /explain current block content into params.selection.text", async () => {
    const onExecuteApi = vi.fn().mockResolvedValue(undefined);
    const items = buildSlashCommandItems(makeContext({ onExecuteApi }));

    const explain = items.find((item) => item.id === "explain");
    expect(explain).toBeDefined();

    await explain!.run(makeContext({ onExecuteApi }));

    expect(onExecuteApi).toHaveBeenCalledWith(
      "explain",
      expect.objectContaining({
        selection: { text: "Selected block text" },
      }),
    );
  });
});
