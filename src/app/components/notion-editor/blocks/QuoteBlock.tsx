"use client";

import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";

interface QuoteBlockProps {
  block: Block;
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

export function QuoteBlock({
  block,
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
}: QuoteBlockProps) {
  return (
    <div className="my-2 border-l-4 border-neutral-300 dark:border-neutral-600 pl-4 italic text-neutral-600 dark:text-neutral-400">
      <TipTapBlock
        block={block}
        blockType="quote"
        onUpdate={onUpdate}
        onEnter={onEnter}
        onBackspace={onBackspace}
        onSlashCommand={onSlashCommand}
        placeholder="Quote..."
        paperId={paperId}
        blockIndex={blockIndex}
        onChangeBlockType={onChangeBlockType}
        onInsertBlock={onInsertBlock}
        onExecuteApi={onExecuteApi}
        isLocked={isLocked}
      />
    </div>
  );
}

