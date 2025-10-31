"use client";

import { NotionEditor } from "@/app/components/notion-editor/NotionEditor";
import type { Block } from "@/app/components/notion-editor/types";

// Test page for NotionEditor
export default function TestNotionPage() {
  const initialBlocks: Block[] = [
    {
      id: "1",
      type: "heading_1",
      content: "Test Notion Editor",
    },
    {
      id: "2",
      type: "paragraph",
      content: "This is a test page for the Notion-style editor.",
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
        <h1 className="text-2xl font-bold mb-4">Notion Editor Test</h1>
        <NotionEditor
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

