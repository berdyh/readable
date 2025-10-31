"use client";

import { clsx } from "clsx";
import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";

interface ListBlockProps {
  block: Block;
  index: number;
  onUpdate: (content: string) => void;
  onEnter?: (markDone?: boolean) => void;
  onBackspace?: () => void;
  onSlashCommand?: (query: string) => void;
  paperId?: string;
  blockIndex?: number;
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
  const isBulletList = block.type === "bullet_list";

  return (
    <div className="flex items-start gap-2 w-full">
      <div
        className={clsx(
          "mt-1 text-neutral-600 dark:text-neutral-400",
          isBulletList ? "text-xl" : "text-sm font-mono",
        )}
      >
        {isBulletList ? "•" : `${index + 1}.`}
      </div>
      <div className="flex-1">
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
