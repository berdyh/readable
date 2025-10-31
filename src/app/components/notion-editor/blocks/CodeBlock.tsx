"use client";

import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";

interface CodeBlockProps {
  block: Block;
  onUpdate: (content: string) => void;
  onEnter?: () => void;
  onBackspace?: () => void;
  onSlashCommand?: (query: string) => void;
  paperId?: string;
  blockIndex?: number;
  onChangeBlockType?: (blockId: string, newType: Block["type"]) => void;
  onInsertBlock?: (type: Block["type"], index: number, content?: string) => void;
  onExecuteApi?: (command: string, params?: Record<string, unknown>) => Promise<void>;
  isLocked?: boolean;
}

export function CodeBlock({
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
}: CodeBlockProps) {
  return (
    <div className="my-2 rounded-md bg-neutral-100 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-3">
      <TipTapBlock
        block={block}
        blockType="code"
        onUpdate={onUpdate}
        onEnter={onEnter}
        onBackspace={onBackspace}
        onSlashCommand={onSlashCommand}
        placeholder="Code..."
        className="font-mono text-sm"
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

