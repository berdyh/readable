"use client";

import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";

interface HeadingBlockProps {
  block: Block;
  onUpdate: (content: string) => void;
  onEnter?: () => void;
  onBackspace?: () => void;
  onSlashCommand?: (query: string) => void;
  paperId?: string;
  blockIndex?: number;
  onChangeBlockType?: (blockId: string, newType: Block["type"]) => void;
  onInsertBlock?: (type: Block["type"], index: number, content?: string) => void;
}

export function HeadingBlock({
  block,
  onUpdate,
  onEnter,
  onBackspace,
  onSlashCommand,
  paperId,
  blockIndex = 0,
  onChangeBlockType,
  onInsertBlock,
}: HeadingBlockProps) {
  const placeholder =
    block.type === "heading_1"
      ? "Heading 1"
      : block.type === "heading_2"
        ? "Heading 2"
        : "Heading 3";

  return (
    <TipTapBlock
      block={block}
      blockType={block.type}
      onUpdate={onUpdate}
      onEnter={onEnter}
      onBackspace={onBackspace}
      onSlashCommand={onSlashCommand}
      placeholder={placeholder}
      paperId={paperId}
      blockIndex={blockIndex}
      onChangeBlockType={onChangeBlockType}
      onInsertBlock={onInsertBlock}
    />
  );
}
