"use client";

import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";

interface ListBlockProps {
  block: Block;
  index: number; // Visual index for numbering (from Block.tsx map index)
  onUpdate: (content: string) => void;
  onEnter?: (markDone?: boolean) => void;
  onBackspace?: () => void;
  onSlashCommand?: (query: string) => void;
  paperId?: string;
  blockIndex?: number; // Actual block index in the editor
  onChangeBlockType?: (blockId: string, newType: Block["type"]) => void;
  onInsertBlock?: (type: Block["type"], index: number, content?: string) => void;
  onExecuteApi?: (command: string, params?: Record<string, unknown>) => Promise<void>;
  isLocked?: boolean;
}

export function ListBlock({
  block,
  index,
  onUpdate,
  onEnter,
  onBackspace,
  onSlashCommand,
  paperId,
  blockIndex = 0,
  onChangeBlockType,
  onInsertBlock,
  onExecuteApi,
  isLocked = false,
}: ListBlockProps) {
  return (
    <TipTapBlock
      block={block}
      blockType={block.type}
      onUpdate={onUpdate}
      onEnter={onEnter}
      onBackspace={onBackspace}
      onSlashCommand={onSlashCommand}
      placeholder={block.type === "bullet_list" ? "List item" : `List item ${index + 1}`}
      paperId={paperId}
      blockIndex={blockIndex}
      onChangeBlockType={onChangeBlockType}
      onInsertBlock={onInsertBlock}
      onExecuteApi={onExecuteApi}
      isLocked={isLocked}
    />
  );
}
