"use client";

import { clsx } from "clsx";
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
  index, // Visual index for display
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
  const isBulletList = block.type === "bullet_list";

  return (
    <div className="flex items-start gap-2 w-full">
      <div
        className={clsx(
          "flex items-center justify-center min-w-[24px] text-neutral-600 dark:text-neutral-400 select-none flex-shrink-0",
          isBulletList ? "text-xl" : "text-sm font-mono",
        )}
        style={{ 
          height: "1.5rem", // Match typical line height
          lineHeight: "1.5rem", // Center the bullet/number vertically
        }}
      >
        {isBulletList ? "•" : `${index + 1}.`}
      </div>
      <div className="flex-1 min-w-0">
        <TipTapBlock
          block={block}
          blockType={block.type}
          onUpdate={onUpdate}
          onEnter={onEnter}
          onBackspace={onBackspace}
          onSlashCommand={onSlashCommand}
          placeholder="List item"
          paperId={paperId}
          blockIndex={blockIndex}
          onChangeBlockType={onChangeBlockType}
          onInsertBlock={onInsertBlock}
          onExecuteApi={onExecuteApi}
          isLocked={isLocked}
        />
      </div>
    </div>
  );
}
