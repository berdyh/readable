import type { Block, BlockType } from "./types";

export function isBlockContentEmpty(content: string | undefined): boolean {
  const blockContent = content?.trim() || "";
  const textContent = blockContent
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&[a-zA-Z]+;/g, "")
    .trim();

  return (
    blockContent.length === 0 ||
    blockContent === "<p></p>" ||
    blockContent === "<p><br></p>" ||
    blockContent === "<br>" ||
    textContent.length === 0
  );
}

export function resolveDropReorder(
  blocks: Block[],
  draggedBlockId: string,
  targetBlockId: string,
  dropPosition: "before" | "after",
): { toIndex: number } | null {
  if (draggedBlockId === targetBlockId) return null;

  const fromIndex = blocks.findIndex((item) => item.id === draggedBlockId);
  const targetIndex = blocks.findIndex((item) => item.id === targetBlockId);
  if (fromIndex < 0 || targetIndex < 0) return null;

  const insertIndex = dropPosition === "before" ? targetIndex : targetIndex + 1;
  const toIndex = fromIndex < insertIndex ? insertIndex - 1 : insertIndex;

  if (toIndex === fromIndex) return null;

  return { toIndex };
}

export function getDeletionFocusTarget(
  blocks: Block[],
  blockId: string,
  triggerKey: "Backspace" | "Delete",
): { blockId: string; position: "start" | "end" } | null {
  const index = blocks.findIndex((block) => block.id === blockId);
  if (index < 0) return null;

  if (triggerKey === "Delete") {
    const nextId = blocks[index + 1]?.id;
    if (nextId) {
      return { blockId: nextId, position: "start" };
    }

    const previousId = blocks[index - 1]?.id;
    return previousId ? { blockId: previousId, position: "end" } : null;
  }

  const previousId = blocks[index - 1]?.id;
  return previousId ? { blockId: previousId, position: "end" } : null;
}

/**
 * Block types that must span the full column rather than the ~70ch prose
 * measure.
 *
 * The measure exists because past roughly 70 characters the eye loses the start
 * of the next line on the return sweep. That reasoning only applies to running
 * prose — none of these are prose:
 *
 * - `figure`   a figure narrowed to 70ch is unreadable.
 * - `code`     code wraps badly; horizontal scroll is the expected behaviour.
 * - `divider`  a rule that stops short of the column edge reads as a rendering
 *              bug rather than a divider.
 * - `chat_message`  carries its own bubble layout and padding.
 */
const FULL_BLEED_BLOCK_TYPES = new Set<BlockType>(["figure", "code", "divider", "chat_message"]);

export function isFullBleedBlock(type: BlockType): boolean {
  return FULL_BLEED_BLOCK_TYPES.has(type);
}
