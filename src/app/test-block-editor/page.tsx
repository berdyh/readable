"use client";

import { BlockEditor } from "@/app/components/block-editor/BlockEditor";
import type { Block } from "@/app/components/block-editor/types";

// Test page for BlockEditor
export default function TestBlockEditorPage() {
  const initialBlocks: Block[] = [
    {
      id: "1",
      type: "heading_1",
      content: "Test Block Editor",
    },
    {
      id: "2",
      type: "paragraph",
      content: "This is a test page for the block-based editor.",
    },
    {
      id: "3",
      type: "bullet_list",
      content: "First list item",
    },
    {
      id: "4",
      type: "to_do_list",
      content: "Test todo item",
      metadata: { checked: false },
    },
  ];

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <div className="container mx-auto py-8">
        <h1 className="text-2xl font-bold mb-4">Block Editor Test</h1>
        <BlockEditor
          paperId="test-paper"
          initialBlocks={initialBlocks}
          onSlashCommand={(query, index) => {
            console.log("Slash command:", query, "at index:", index);
          }}
        />
      </div>
    </div>
  );
}

