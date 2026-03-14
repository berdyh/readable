import { describe, expect, it } from "vitest";

import { getAllSlashCommands } from "./commands";

describe("slash command discovery", () => {
  it("includes research commands currently registered in the command registry", () => {
    const allCommands = getAllSlashCommands();
    const ids = allCommands.map((command) => command.id);

    expect(ids).toContain("summary");
    expect(ids).toContain("figure");
    expect(ids).toContain("cite");
    expect(ids).toContain("arxiv");
    expect(ids).toContain("explain");
    expect(ids).toContain("compare");
    expect(ids).toContain("chat");
  });

  it("returns command items with executable run handlers", () => {
    const allCommands = getAllSlashCommands();

    expect(allCommands.length).toBeGreaterThan(0);
    allCommands.forEach((command) => {
      expect(typeof command.run).toBe("function");
    });
  });
});
