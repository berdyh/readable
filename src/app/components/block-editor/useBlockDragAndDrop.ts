"use client";

import { useCallback, useState } from "react";

import { resolveDropReorder } from "./blockInteractionUtils";
import type { Block } from "./types";

/**
 * Drag-to-reorder for a single block.
 *
 * Extracted from Block.tsx to get that component under the size at which the
 * React Compiler bails out. The bailout is silent — `set-state-in-effect` is
 * configured at error level but never ran on the 486-line original, and
 * `react-hooks/unsupported-syntax` does not fire either, so a clean lint run
 * there was not evidence of anything. See docs/open-issues.md.
 *
 * The drop-target arithmetic itself stays in `resolveDropReorder`, which is
 * pure and unit-tested; everything here is DOM plumbing that only runs in a
 * browser.
 */
export function useBlockDragAndDrop({
  blockId,
  blocks,
  moveBlock,
}: {
  blockId: string;
  blocks: Block[];
  moveBlock: (draggedBlockId: string, toIndex: number) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const onDragStart = useCallback(
    (e: React.DragEvent) => {
      setIsDragging(true);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", blockId);
      // Marks this as a block reorder so TipTap's handleDrop can decline it —
      // without the marker, dropping a block inside a paragraph would be
      // treated as a text drop.
      e.dataTransfer.setData("application/x-block-reorder", "true");
      e.stopPropagation();
      if (e.dataTransfer.setDragImage) {
        const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
        dragImage.style.opacity = "0.5";
        dragImage.style.transform = "rotate(2deg)";
        document.body.appendChild(dragImage);
        e.dataTransfer.setDragImage(dragImage, 0, 0);
        setTimeout(() => document.body.removeChild(dragImage), 0);
      }
    },
    [blockId],
  );

  const onDragEnd = useCallback((e: React.DragEvent) => {
    setIsDragging(false);
    setDragOver(false);
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // dragleave also fires when the pointer crosses onto a child element, so
    // clearing unconditionally would flicker the drop indicator. Only clear
    // once the pointer is genuinely outside the block's box.
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOver(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOver(false);
      setIsDragging(false);

      const isBlockReorder = e.dataTransfer.getData("application/x-block-reorder") === "true";
      if (!isBlockReorder) return;

      const draggedBlockId = e.dataTransfer.getData("text/plain");
      if (!draggedBlockId || draggedBlockId === blockId) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const midPoint = rect.top + rect.height / 2;
      const dropPosition = e.clientY < midPoint ? "before" : "after";
      const reorder = resolveDropReorder(blocks, draggedBlockId, blockId, dropPosition);
      if (!reorder) return;

      moveBlock(draggedBlockId, reorder.toIndex);
    },
    [blockId, blocks, moveBlock],
  );

  return { isDragging, dragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop };
}
