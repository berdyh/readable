"use client";

import { EditorProvider, useEditorStore } from "./store";
import { Block } from "./Block";
import type { Block as BlockType } from "./types";

interface NotionEditorProps {
  paperId: string;
  initialBlocks?: BlockType[];
  onSlashCommand?: (query: string, blockIndex: number) => void;
}

export function NotionEditor({
  paperId,
  initialBlocks = [],
  onSlashCommand,
}: NotionEditorProps) {
  return (
    <EditorProvider paperId={paperId} initialBlocks={initialBlocks}>
      <NotionEditorContent onSlashCommand={onSlashCommand} />
    </EditorProvider>
  );
}

function NotionEditorContent({
  onSlashCommand,
}: {
  onSlashCommand?: (query: string, blockIndex: number) => void;
}) {
  const { state } = useEditorStore();

  // Always ensure there's at least one block
  const blocksToRender = state.blocks.length === 0 
    ? [{ id: "placeholder", type: "paragraph" as const, content: "" }]
    : state.blocks;

  return (
    <div className="w-full max-w-4xl mx-auto p-8">
      <div className="min-h-[400px] space-y-1">
        {blocksToRender.map((block, index) => (
          <Block
            key={block.id}
            block={block}
            index={index}
            onSlashCommand={onSlashCommand}
          />
        ))}
      </div>
    </div>
  );
}
