import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalAgentPicker } from "./local-agent-picker";
import type { LocalAgentStatus } from "../model/localAgents";

function agent(overrides: Partial<LocalAgentStatus> & Pick<LocalAgentStatus, "id">) {
  return {
    displayName: overrides.id === "codex-cli" ? "Codex" : "Claude Code",
    installed: true,
    authenticated: true,
    model: "default",
    unavailableReason: null,
    ...overrides,
  } satisfies LocalAgentStatus;
}

/**
 * The picker's whole job is to keep the user from choosing an agent that
 * cannot answer. An agent the machine can't run has to look unusable *and* be
 * unusable — a control that merely looks greyed out but still fires is worse
 * than no picker, because the request fails with no explanation.
 */
describe("LocalAgentPicker availability", () => {
  it("lets the user switch between agents that are ready", () => {
    const onSelect = vi.fn();
    render(
      <LocalAgentPicker
        agents={[agent({ id: "codex-cli" }), agent({ id: "claude-code" })]}
        selectedAgentId="codex-cli"
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("radio", { name: "Codex" })).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
    expect(onSelect).toHaveBeenCalledWith("claude-code");
  });

  it("greys out an agent that is not installed and refuses the click", () => {
    const onSelect = vi.fn();
    render(
      <LocalAgentPicker
        agents={[
          agent({ id: "codex-cli" }),
          agent({
            id: "claude-code",
            installed: false,
            authenticated: false,
            unavailableReason: "not_installed",
            hint: "Install Claude Code: `npm i -g @anthropic-ai/claude-code` then run `claude login`.",
          }),
        ]}
        selectedAgentId="codex-cli"
        onSelect={onSelect}
      />,
    );

    const claude = screen.getByRole("radio", { name: /Claude Code is not installed/ });
    expect(claude).toBeDisabled();

    fireEvent.click(claude);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("says 'not signed in' rather than 'not installed' when the CLI is there", () => {
    render(
      <LocalAgentPicker
        agents={[
          agent({
            id: "codex-cli",
            installed: true,
            authenticated: false,
            unavailableReason: "not_authenticated",
            hint: "Install Codex CLI: `npm i -g @openai/codex` then run `codex login`.",
          }),
        ]}
        onSelect={vi.fn()}
      />,
    );

    // The distinction is the point: "install it" is the wrong instruction for
    // someone who already has it.
    const codex = screen.getByRole("radio", { name: /Codex is installed but not signed in/ });
    expect(codex).toBeDisabled();
    // The remedy travels with the reason.
    expect(codex).toHaveAttribute("title", expect.stringContaining("codex login"));
  });

  it("never shows an unavailable agent as the selected one", () => {
    render(
      <LocalAgentPicker
        agents={[
          agent({
            id: "codex-cli",
            authenticated: false,
            unavailableReason: "not_authenticated",
          }),
        ]}
        // A stale selection pointing at an agent that has since signed out.
        selectedAgentId="codex-cli"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /not signed in/ })).not.toBeChecked();
  });

  it("renders nothing when there are no agents to choose between", () => {
    const { container } = render(<LocalAgentPicker agents={[]} onSelect={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("blocks selection while an answer is in flight", () => {
    const onSelect = vi.fn();
    render(
      <LocalAgentPicker
        agents={[agent({ id: "codex-cli" }), agent({ id: "claude-code" })]}
        selectedAgentId="codex-cli"
        onSelect={onSelect}
        disabled
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Claude Code" }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
