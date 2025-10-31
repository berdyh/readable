"use client";

import type { Block } from "../types";

interface DividerBlockProps {
  block: Block;
}

export function DividerBlock({ block }: DividerBlockProps) {
  return (
    <div className="my-4 flex items-center gap-4">
      <div className="flex-1 border-t border-neutral-300 dark:border-neutral-600" />
      <div className="text-xs text-neutral-400 dark:text-neutral-500">Divider</div>
      <div className="flex-1 border-t border-neutral-300 dark:border-neutral-600" />
    </div>
  );
}

