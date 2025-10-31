"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Loader2, AlertCircle } from "lucide-react";
import { EditorProvider, useEditorStore } from "./store";
import { Block } from "./Block";
import type { Block as BlockType } from "./types";
import { ChatButton, ChatSidePanel } from "./ChatIntegration";
import type { QuestionSelection } from "@/server/qa/types";

interface NotionEditorProps {
  paperId: string;
  initialBlocks?: BlockType[];
  onSlashCommand?: (query: string, blockIndex: number) => void;
  statusMessage?: string | null;
  errorMessage?: string | null;
  onStatusClear?: () => void;
  showChatButton?: boolean;
  personaEnabled?: boolean;
  onPersonaToggle?: (enabled: boolean) => void;
  userId?: string;
}

export function NotionEditor({
  paperId,
  initialBlocks = [],
  onSlashCommand,
  statusMessage,
  errorMessage,
  onStatusClear,
  showChatButton = true,
  personaEnabled = false,
  onPersonaToggle,
  userId,
}: NotionEditorProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatSelection, setChatSelection] = useState<QuestionSelection | undefined>(undefined);

  return (
    <EditorProvider paperId={paperId} initialBlocks={initialBlocks}>
      <NotionEditorContent
        onSlashCommand={onSlashCommand}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        onStatusClear={onStatusClear}
        isChatOpen={isChatOpen}
        onChatToggle={setIsChatOpen}
        chatSelection={chatSelection}
        onChatSelectionClear={() => setChatSelection(undefined)}
        showChatButton={showChatButton}
        paperId={paperId}
        personaEnabled={personaEnabled}
        onPersonaToggle={onPersonaToggle}
        userId={userId}
      />
    </EditorProvider>
  );
}

function NotionEditorContent({
  onSlashCommand,
  statusMessage,
  errorMessage,
  onStatusClear,
  isChatOpen,
  onChatToggle,
  chatSelection,
  onChatSelectionClear,
  showChatButton,
  paperId,
  personaEnabled,
  onPersonaToggle,
  userId,
}: {
  onSlashCommand?: (query: string, blockIndex: number) => void;
  statusMessage?: string | null;
  errorMessage?: string | null;
  onStatusClear?: () => void;
  isChatOpen: boolean;
  onChatToggle: (open: boolean) => void;
  chatSelection?: QuestionSelection;
  onChatSelectionClear?: () => void;
  showChatButton: boolean;
  paperId: string;
  personaEnabled?: boolean;
  onPersonaToggle?: (enabled: boolean) => void;
  userId?: string;
}) {
  const { state, insertBlock } = useEditorStore();

  // Auto-clear status messages after 3 seconds
  useEffect(() => {
    if (statusMessage && onStatusClear) {
      const timer = setTimeout(() => {
        onStatusClear();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage, onStatusClear]);

  // Always ensure there's at least one block
  const blocksToRender = state.blocks.length === 0 
    ? [{ id: "placeholder", type: "paragraph" as const, content: "" }]
    : state.blocks;

  return (
    <div className="w-full max-w-4xl mx-auto p-8">
      {/* Status and Error Messages */}
      {(statusMessage || errorMessage) && (
        <div className="mb-4 flex flex-col gap-2">
          {statusMessage && (
            <div className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/20 dark:text-blue-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{statusMessage}</span>
            </div>
          )}
          {errorMessage && (
            <div className="inline-flex items-center justify-between gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>{errorMessage}</span>
              </div>
              {onStatusClear && (
                <button
                  type="button"
                  onClick={onStatusClear}
                  className="text-xs uppercase hover:underline"
                >
                  Dismiss
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Loading State */}
      {state.loading && state.blocks.length === 0 && (
        <div className="flex min-h-[400px] items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-neutral-400" />
            <p className="text-sm text-neutral-500">Loading editor...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {state.error && !errorMessage && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-800 dark:bg-red-950/20 dark:text-red-200">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            <span>{state.error}</span>
          </div>
        </div>
      )}

      {/* Block Editor */}
      <div className={clsx("min-h-[400px] space-y-1", state.loading && "opacity-50")}>
        {blocksToRender.map((block, index) => (
          <Block
            key={block.id}
            block={block}
            index={index}
            onSlashCommand={onSlashCommand}
          />
        ))}
      </div>

      {/* Floating Chat Button */}
      {showChatButton && !isChatOpen && (
        <ChatButton onClick={() => onChatToggle(true)} />
      )}

      {/* Side Chat Panel */}
      <ChatSidePanel
        paperId={paperId}
        isOpen={isChatOpen}
        onToggle={onChatToggle}
        selection={chatSelection}
        onSelectionClear={onChatSelectionClear}
        personaEnabled={personaEnabled}
        onPersonaToggle={onPersonaToggle}
        userId={userId}
        onInsertBlocks={(blocks) => {
          // Insert blocks after the last block
          blocks.forEach((block, i) => {
            insertBlock(block, state.blocks.length + i);
          });
        }}
      />
    </div>
  );
}
