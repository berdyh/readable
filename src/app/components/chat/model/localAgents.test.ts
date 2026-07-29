import { describe, expect, it } from "vitest";

import {
  describeAgentUnavailability,
  isAgentSelectable,
  pickDefaultAgent,
  shouldShowAgentPicker,
  type LocalAgentStatus,
} from "./localAgents";

function agent(overrides: Partial<LocalAgentStatus> & Pick<LocalAgentStatus, "id">) {
  return {
    displayName: overrides.id,
    installed: true,
    authenticated: true,
    model: "default",
    unavailableReason: null,
    ...overrides,
  } satisfies LocalAgentStatus;
}

describe("pickDefaultAgent", () => {
  it("starts on the first agent that can actually answer", () => {
    expect(
      pickDefaultAgent([
        agent({ id: "codex-cli", unavailableReason: "not_authenticated" }),
        agent({ id: "claude-code" }),
      ]),
    ).toBe("claude-code");
  });

  it("returns undefined when nothing is usable", () => {
    // Distinct from "not loaded yet" — every CLI missing is a real state the
    // panel has to render differently from a pending probe.
    expect(
      pickDefaultAgent([agent({ id: "codex-cli", unavailableReason: "not_installed" })]),
    ).toBeUndefined();
  });
});

describe("describeAgentUnavailability", () => {
  it("says nothing about an agent that works", () => {
    expect(describeAgentUnavailability(agent({ id: "codex-cli" }))).toBeUndefined();
    expect(isAgentSelectable(agent({ id: "codex-cli" }))).toBe(true);
  });

  it("distinguishes missing from signed-out, and carries the remedy", () => {
    expect(
      describeAgentUnavailability(
        agent({
          id: "codex-cli",
          displayName: "Codex",
          unavailableReason: "not_installed",
          hint: "Run `npm i -g @openai/codex`.",
        }),
      ),
    ).toBe("Codex is not installed. Run `npm i -g @openai/codex`.");

    expect(
      describeAgentUnavailability(
        agent({
          id: "claude-code",
          displayName: "Claude Code",
          unavailableReason: "not_authenticated",
        }),
      ),
    ).toBe("Claude Code is installed but not signed in.");
  });
});

describe("shouldShowAgentPicker", () => {
  it("stays hidden on hosted providers and before the probe resolves", () => {
    expect(shouldShowAgentPicker(undefined)).toBe(false);
    expect(shouldShowAgentPicker({ enabled: false, agents: [] })).toBe(false);
    // Enabled but nothing to list is still nothing to choose between.
    expect(shouldShowAgentPicker({ enabled: true, agents: [] })).toBe(false);
  });

  it("shows even a single agent, so the user knows which one answers", () => {
    expect(shouldShowAgentPicker({ enabled: true, agents: [agent({ id: "codex-cli" })] })).toBe(
      true,
    );
  });
});
