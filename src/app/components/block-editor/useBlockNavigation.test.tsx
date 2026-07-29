import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { emitBlockNavigate, onBlockNavigateResult } from "./navigation";
import type { BlockNavigateFailureReason, BlockNavigateStatus } from "./navigation";
import type { Block } from "./types";
import { useBlockNavigation } from "./useBlockNavigation";

/**
 * The DOM half of the chat → editor seam. `blockNavigation.ts` resolves which
 * block a citation points at and is unit-tested in the node project; nothing
 * covered what happens after — the scroll, and crucially the reply that tells
 * chat whether the reveal worked.
 *
 * Every test here subscribes in the same order `sources.tsx` does — emit first,
 * then listen — because that ordering is what exposed the race where a
 * successfully revealed citation was reported as unavailable.
 */
const BLOCKS: Block[] = [
  { id: "b1", type: "paragraph", content: "Self-attention removes recurrence." },
  { id: "b2", type: "paragraph", content: "Multi-head attention uses subspaces." },
];

function Harness({ blocks = BLOCKS, paperId = "1706.03762" }) {
  useBlockNavigation(blocks, paperId);
  return null;
}

/**
 * Mirrors how Block.tsx marks each rendered block for the resolver. Each element
 * gets its OWN scrollIntoView spy — a shared Element.prototype mock cannot tell
 * you which block was revealed, only that something was.
 */
function mountBlockElements(ids: string[]) {
  for (const id of ids) {
    const el = document.createElement("div");
    el.setAttribute("data-block-id", id);
    el.scrollIntoView = vi.fn();
    document.body.appendChild(el);
  }
}

interface Reply {
  status: BlockNavigateStatus;
  reason?: BlockNavigateFailureReason;
}

/** emit → subscribe, exactly as sources.tsx handleClick does. */
async function navigateAndAwaitReply(
  detail: Parameters<typeof emitBlockNavigate>[0],
): Promise<Reply[]> {
  const replies: Reply[] = [];
  const requestId = emitBlockNavigate(detail);
  onBlockNavigateResult(requestId, (status, reason) => replies.push({ status, reason }));
  // Let the deferred reply land.
  await Promise.resolve();
  return replies;
}

beforeEach(() => {
  // jsdom does not implement it at all; revealBlock calls it unconditionally.
  // Per-element spies in mountBlockElements override this for assertions.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useBlockNavigation", () => {
  it("scrolls the matching block into view", () => {
    mountBlockElements(["b1", "b2"]);
    render(<Harness />);

    emitBlockNavigate({ paperId: "1706.03762", quote: "Multi-head attention uses subspaces." });

    expect(document.querySelector('[data-block-id="b2"]')!.scrollIntoView).toHaveBeenCalledOnce();
    expect(document.querySelector('[data-block-id="b1"]')!.scrollIntoView).not.toHaveBeenCalled();
  });

  it("reports success to a caller that subscribes after emitting", async () => {
    // The regression guard. emitBlockNavigate dispatches synchronously and only
    // then returns the requestId, so replying inline meant the caller always
    // missed it and sources.tsx timed out into "unavailable" on a citation that
    // had in fact been revealed.
    mountBlockElements(["b1"]);
    render(<Harness />);

    const replies = await navigateAndAwaitReply({
      paperId: "1706.03762",
      quote: "Self-attention removes recurrence.",
    });

    expect(replies).toEqual([{ status: "success", reason: undefined }]);
  });

  it("reports unavailable rather than staying silent when nothing matches", async () => {
    mountBlockElements(["b1", "b2"]);
    render(<Harness />);

    const replies = await navigateAndAwaitReply({
      paperId: "1706.03762",
      quote: "A sentence that appears in no block at all.",
    });

    expect(replies).toEqual([{ status: "unavailable", reason: "target-not-found" }]);
  });

  it("distinguishes a resolved block whose element is not mounted", async () => {
    // The resolver finds b2, but the editor never rendered it. That is a
    // different failure from "no such citation", and chat needs to tell them
    // apart to know whether the answer or the render is at fault.
    render(<Harness />);

    const replies = await navigateAndAwaitReply({
      paperId: "1706.03762",
      quote: "Multi-head attention uses subspaces.",
    });

    expect(replies).toEqual([{ status: "unavailable", reason: "element-not-found" }]);
  });

  it("ignores navigation aimed at a different paper", async () => {
    mountBlockElements(["b1"]);
    render(<Harness />);

    const replies = await navigateAndAwaitReply({
      paperId: "9999.00000",
      quote: "Self-attention removes recurrence.",
    });

    expect(replies).toEqual([]);
  });

  it("stops listening once the editor unmounts", async () => {
    mountBlockElements(["b1"]);
    const { unmount } = render(<Harness />);
    unmount();

    const replies = await navigateAndAwaitReply({
      paperId: "1706.03762",
      quote: "Self-attention removes recurrence.",
    });

    expect(replies).toEqual([]);
  });
});
