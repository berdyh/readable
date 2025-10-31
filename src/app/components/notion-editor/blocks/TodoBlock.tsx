"use client";

import { type ChangeEvent } from "react";
import { clsx } from "clsx";
import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";

interface TodoBlockProps {
  block: Block;
  onUpdate: (content: string) => void;
  onEnter?: () => void;
  onBackspace?: () => void;
  onSlashCommand?: (query: string) => void;
  updateBlock: (blockId: string, updates: Partial<Block>) => void;
  paperId?: string;
  blockIndex?: number;
  onChangeBlockType?: (blockId: string, newType: Block["type"]) => void;
  onInsertBlock?: (type: Block["type"], index: number, content?: string) => void;
  onExecuteApi?: (command: string, params?: Record<string, unknown>) => Promise<void>;
}

export function TodoBlock({
  block,
  onUpdate,
  onEnter,
  onBackspace,
  onSlashCommand,
  updateBlock,
  paperId,
  blockIndex = 0,
  onChangeBlockType,
  onInsertBlock,
  onExecuteApi,
}: TodoBlockProps) {
  const checked = block.metadata?.checked ?? false;

  const handleCheckboxChange = (e: ChangeEvent<HTMLInputElement>) => {
    updateBlock(block.id, {
      metadata: { ...block.metadata, checked: e.target.checked },
    });
  };

  return (
    <div className="flex items-start gap-2 w-full">
      <input
        type="checkbox"
        checked={checked}
        onChange={handleCheckboxChange}
        className="mt-1 h-4 w-4 cursor-pointer rounded border-neutral-300"
      />
      <div className={clsx("flex-1", checked && "opacity-60")}>
        <TipTapBlock
          block={block}
          blockType="to_do_list"
          onUpdate={onUpdate}
          onEnter={onEnter}
          onBackspace={onBackspace}
          onSlashCommand={onSlashCommand}
          placeholder="To-do"
          className={checked ? "line-through text-neutral-500" : ""}
          paperId={paperId}
          blockIndex={blockIndex}
          onChangeBlockType={onChangeBlockType}
          onInsertBlock={onInsertBlock}
          onExecuteApi={onExecuteApi}
        />
      </div>
    </div>
  );
}
