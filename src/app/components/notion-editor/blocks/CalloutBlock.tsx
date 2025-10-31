"use client";

import { AlertCircle } from "lucide-react";
import type { Block } from "../types";
import { TipTapBlock } from "./TipTapBlock";
import { clsx } from "clsx";

interface CalloutBlockProps {
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
}

export function CalloutBlock({
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
}: CalloutBlockProps) {
  // Determine callout type from metadata or default to info
  const calloutType = (block.metadata?.type as string) || "info";
  const bgColors: Record<string, string> = {
    info: "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800",
    warning: "bg-yellow-50 dark:bg-yellow-950/20 border-yellow-200 dark:border-yellow-800",
    error: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
    success: "bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800",
  };

  return (
    <div
      className={clsx(
        "my-2 rounded-lg border p-4",
        bgColors[calloutType] || bgColors.info,
      )}
    >
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
        <div className="flex-1">
          <TipTapBlock
            block={block}
            blockType="callout"
            onUpdate={onUpdate}
            onEnter={onEnter}
            onBackspace={onBackspace}
            onSlashCommand={onSlashCommand}
            placeholder="Callout..."
            paperId={paperId}
            blockIndex={blockIndex}
            onChangeBlockType={onChangeBlockType}
            onInsertBlock={onInsertBlock}
            onExecuteApi={onExecuteApi}
          />
        </div>
      </div>
    </div>
  );
}

