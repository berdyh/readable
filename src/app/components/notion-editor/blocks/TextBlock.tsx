"use client";

import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";

interface TextBlockProps {
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

export function TextBlock({
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
}: TextBlockProps) {
  return (
    <TipTapBlock
      block={block}
      blockType="paragraph"
      onUpdate={onUpdate}
      onEnter={onEnter}
      onBackspace={onBackspace}
      onSlashCommand={onSlashCommand}
      placeholder="Type '/' for commands"
      paperId={paperId}
      blockIndex={blockIndex}
      onChangeBlockType={onChangeBlockType}
      onInsertBlock={onInsertBlock}
      onExecuteApi={onExecuteApi}
      isLocked={isLocked}
    />
  );
}
