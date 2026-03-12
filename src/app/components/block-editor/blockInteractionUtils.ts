import type { Block } from "./types";

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
