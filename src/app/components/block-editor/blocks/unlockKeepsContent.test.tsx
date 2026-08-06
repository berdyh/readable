import { act, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { HeadingBlock } from "./HeadingBlock";
import { ListBlock } from "./ListBlock";
import type { Block } from "../types";

/**
 * Unlocking a generated block must not change what it says.
 *
 * TipTap emits an update as soon as `setEditable(true)` runs — before the
 * reader has typed anything — and that update is serialized straight back into
 * `block.content`. When the serializer re-derived block-level markdown the
 * block type already encodes, a summary heading reading `Paper Summary` was
 * silently stored as `# Paper Summary` (and a key point as `- A key point.`),
 * which also marked the document dirty and put the reader's next document swap
 * at risk.
 *
 * Rendered, not unit-tested: the rewrite only happens once React, TipTap and
 * the lock toggle are all in play.
 */
function LockHarness({
  initial,
  render: renderBlock,
}: {
  initial: Block;
  render: (block: Block, isLocked: boolean, onUpdate: (content: string) => void) => ReactNode;
}) {
  const [block, setBlock] = useState(initial);
  const isLocked = block.metadata?.locked === true;

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          setBlock((previous) => ({
            ...previous,
            metadata: { ...previous.metadata, locked: !isLocked },
          }))
        }
      >
        toggle lock
      </button>
      <div data-testid="stored-content">{block.content}</div>
      {renderBlock(block, isLocked, (content) =>
        setBlock((previous) => ({ ...previous, content })),
      )}
    </div>
  );
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function unlock() {
  await act(async () => {
    screen.getByText("toggle lock").click();
  });
  await settle();
}

function storedContent(): string {
  return screen.getByTestId("stored-content").textContent ?? "";
}

function editorHtml(): string {
  return document.querySelector(".ProseMirror")?.innerHTML ?? "";
}

describe("unlocking a locked block", () => {
  it("leaves a generated heading's title exactly as the parser wrote it", async () => {
    render(
      <LockHarness
        initial={{
          id: "h1",
          type: "heading_1",
          content: "Paper Summary",
          metadata: { locked: true },
        }}
        render={(block, isLocked, onUpdate) => (
          <HeadingBlock block={block} isLocked={isLocked} onUpdate={onUpdate} />
        )}
      />,
    );
    await settle();

    expect(storedContent()).toBe("Paper Summary");

    await unlock();

    expect(storedContent()).toBe("Paper Summary");
    expect(editorHtml()).not.toContain("#");
    expect(screen.getAllByText("Paper Summary").length).toBeGreaterThan(0);
  });

  it("leaves a generated key point alone", async () => {
    render(
      <LockHarness
        initial={{
          id: "b1",
          type: "bullet_list",
          content: "Self-attention removes recurrence.",
          metadata: { locked: true },
        }}
        render={(block, isLocked, onUpdate) => (
          <ListBlock block={block} index={0} isLocked={isLocked} onUpdate={onUpdate} />
        )}
      />,
    );
    await settle();

    await unlock();

    expect(storedContent()).toBe("Self-attention removes recurrence.");
  });

  it("keeps the heading a paragraph element throughout, styled by block type", async () => {
    // TipTap runs with `heading: false`, so a heading block is a styled
    // paragraph and never flips between <p> and <h1> as the lock is toggled.
    render(
      <LockHarness
        initial={{
          id: "h2",
          type: "heading_2",
          content: "Introduction",
          metadata: { locked: true },
        }}
        render={(block, isLocked, onUpdate) => (
          <HeadingBlock block={block} isLocked={isLocked} onUpdate={onUpdate} />
        )}
      />,
    );
    await settle();

    const lockedHtml = editorHtml();
    await unlock();

    expect(editorHtml()).toBe(lockedHtml);
    expect(document.querySelector(".ProseMirror h2")).toBeNull();
  });

  it("does become editable, so the unchanged content is not just a frozen editor", async () => {
    // What the reader types is serialized by `htmlToMarkdown`, covered in
    // utils/markdown.test.ts; jsdom models typing into a contenteditable
    // poorly, so this only pins that the toggle really did unlock the block.
    render(
      <LockHarness
        initial={{
          id: "h3",
          type: "heading_1",
          content: "Paper Summary",
          metadata: { locked: true },
        }}
        render={(block, isLocked, onUpdate) => (
          <HeadingBlock block={block} isLocked={isLocked} onUpdate={onUpdate} />
        )}
      />,
    );
    await settle();

    expect(document.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("false");

    await unlock();

    expect(document.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("true");
    expect(storedContent()).toBe("Paper Summary");
  });
});
