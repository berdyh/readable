import { describe, expect, it } from "vitest";

import { getAllSlashCommands, RESEARCH_COMMANDS } from "./commands";

describe("slash command discovery", () => {
  it("only includes research commands with backend support", () => {
    const ids = RESEARCH_COMMANDS.map((command) => command.id);

    expect(ids).toContain("summary");
    expect(ids).toContain("figure");
    expect(ids).toContain("cite");
    expect(ids).toContain("arxiv");
    expect(ids).toContain("explain");
    expect(ids).toContain("chat");

    expect(ids).not.toContain("compare");
    expect(ids).not.toContain("eli5");
  });

  it("does not expose unsupported command ids through global command list", () => {
    const allIds = getAllSlashCommands().map((command) => command.id);

    expect(allIds).toContain("arxiv");
    expect(allIds).not.toContain("compare");
    expect(allIds).not.toContain("eli5");
  });
});
