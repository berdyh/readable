import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatTabStrip } from "./ChatTabStrip";
import type { ChatTab } from "../model/types";

/**
 * Closing a tab deletes the session on the server, so the confirmation step is
 * the only thing standing between a stray click and destroyed history. It had
 * never been exercised since the sidecar restructure — it rested on types and
 * review alone.
 */
const TABS: ChatTab[] = [
  { id: "chat_1", sessionId: "sess_1", title: "Why self-attention?", messages: [] },
  { id: "chat_2", sessionId: "sess_2", title: "Encoder stack depth", messages: [] },
];

function renderStrip(overrides: Partial<Parameters<typeof ChatTabStrip>[0]> = {}) {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(
    <ChatTabStrip
      tabs={TABS}
      activeTabId="chat_1"
      disabled={false}
      onSelect={onSelect}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onSelect, onClose };
}

describe("ChatTabStrip deletion", () => {
  it("does not delete on the first click", async () => {
    const user = userEvent.setup();
    const { onClose } = renderStrip();

    await user.click(screen.getByLabelText("Delete Why self-attention?"));

    expect(onClose).not.toHaveBeenCalled();
  });

  it("asks for confirmation before destroying anything", async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(screen.getByLabelText("Delete Why self-attention?"));

    expect(screen.getByLabelText("Confirm deleting Why self-attention?")).toBeInTheDocument();
    expect(screen.getByLabelText("Keep chat")).toBeInTheDocument();
  });

  it("deletes only the confirmed tab", async () => {
    const user = userEvent.setup();
    const { onClose } = renderStrip();

    await user.click(screen.getByLabelText("Delete Why self-attention?"));
    await user.click(screen.getByLabelText("Confirm deleting Why self-attention?"));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith("chat_1");
  });

  it("backs out without deleting when the user keeps the chat", async () => {
    const user = userEvent.setup();
    const { onClose } = renderStrip();

    await user.click(screen.getByLabelText("Delete Encoder stack depth"));
    await user.click(screen.getByLabelText("Keep chat"));

    expect(onClose).not.toHaveBeenCalled();
    // And the destructive control is back to its resting state.
    expect(screen.getByLabelText("Delete Encoder stack depth")).toBeInTheDocument();
  });

  it("keeps the delete control visible rather than hover-only", () => {
    // Hover-only controls are unreachable on touch. Both tabs expose theirs
    // without any pointer interaction first.
    renderStrip();

    expect(screen.getByLabelText("Delete Why self-attention?")).toBeVisible();
    expect(screen.getByLabelText("Delete Encoder stack depth")).toBeVisible();
  });

  it("selects a tab without deleting it", async () => {
    const user = userEvent.setup();
    const { onSelect, onClose } = renderStrip();

    await user.click(screen.getByRole("tab", { name: /Encoder stack depth/ }));

    expect(onSelect).toHaveBeenCalledWith("chat_2");
    expect(onClose).not.toHaveBeenCalled();
  });
});
