"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Loader2, AlertCircle, Info } from "lucide-react";
import { EditorProvider, useEditorStore } from "./store";
import { Block } from "./Block";
import type { Block as BlockType } from "./types";
import { useBlockNavigation } from "./useBlockNavigation";
import { ChatButton, ChatSidePanel } from "../chat";
import type { QuestionSelection } from "@/server/qa/types";

interface BlockEditorProps {
  paperId: string;
  initialBlocks?: BlockType[];
  /**
   * Which source document `initialBlocks` came from. Reader edits are kept
   * per key, so switching documents (e.g. the three-pass toggle) restores
   * what was left behind instead of discarding it.
   */
  documentKey?: string;
  onSlashCommand?: (query: string, blockIndex: number) => void;
  statusMessage?: string | null;
  errorMessage?: string | null;
  onStatusClear?: () => void;
  showChatButton?: boolean;
  onChatOpenChange?: (open: boolean) => void;
}

export function BlockEditor({
  paperId,
  initialBlocks = [],
  documentKey,
  onSlashCommand,
  statusMessage,
  errorMessage,
  onStatusClear,
  showChatButton = true,
  onChatOpenChange,
}: BlockEditorProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatSelection, setChatSelection] = useState<QuestionSelection | undefined>(undefined);

  const handleChatToggle = (open: boolean) => {
    setIsChatOpen(open);
    onChatOpenChange?.(open);
  };

  return (
    <EditorProvider paperId={paperId} initialBlocks={initialBlocks} documentKey={documentKey}>
      <BlockEditorContent
        onSlashCommand={onSlashCommand}
        statusMessage={statusMessage}
        errorMessage={errorMessage}
        onStatusClear={onStatusClear}
        isChatOpen={isChatOpen}
        onChatToggle={handleChatToggle}
        chatSelection={chatSelection}
        onChatSelectionClear={() => setChatSelection(undefined)}
        showChatButton={showChatButton}
        paperId={paperId}
      />
    </EditorProvider>
  );
}

function BlockEditorContent({
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
}) {
  const { state, insertBlock, setLocalAgent } = useEditorStore();

  // Auto-clear status messages after 3 seconds
  useEffect(() => {
    if (statusMessage && onStatusClear) {
      const timer = setTimeout(() => {
        onStatusClear();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [statusMessage, onStatusClear]);

  // Chat → editor seam: reveal the block behind a clicked citation.
  useBlockNavigation(state.blocks, paperId);

  // Always ensure there's at least one block
  const blocksToRender =
    state.blocks.length === 0
      ? [{ id: "placeholder", type: "paragraph" as const, content: "" }]
      : state.blocks;

  return (
    <div
      className={clsx(
        "mx-auto flex w-full flex-col transition-[max-width] duration-200 ease-out motion-reduce:transition-none lg:flex-row lg:items-stretch",
        isChatOpen ? "max-w-7xl" : "max-w-4xl",
      )}
    >
      <section className="min-w-0 flex-1 p-8">
        {/* Status and Error Messages */}
        {(statusMessage || errorMessage) && (
          <div className="mb-4 flex flex-col gap-2">
            {statusMessage && (
              <div
                role="status"
                className="inline-flex items-center gap-2 self-start rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
              >
                <Info
                  className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
                <span>{statusMessage}</span>
              </div>
            )}
            {errorMessage && (
              <div
                role="alert"
                className="inline-flex items-center justify-between gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{errorMessage}</span>
                </div>
                {onStatusClear && (
                  <button
                    type="button"
                    onClick={onStatusClear}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium transition-colors duration-150 hover:bg-rose-100 dark:hover:bg-rose-900/50"
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
              <Loader2 className="h-8 w-8 animate-spin text-zinc-400" aria-hidden="true" />
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Loading editor…</p>
            </div>
          </div>
        )}

        {/* Error State */}
        {state.error && !errorMessage && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
              <span>{state.error}</span>
            </div>
          </div>
        )}

        {/* Block Editor */}
        <div
          className={clsx(
            "min-h-[400px] space-y-1 transition-opacity duration-200",
            state.loading && "opacity-50",
          )}
        >
          {blocksToRender.map((block, index) => (
            <Block key={block.id} block={block} index={index} onSlashCommand={onSlashCommand} />
          ))}
        </div>

        {/* Floating Chat Button */}
        {showChatButton && !isChatOpen && <ChatButton onClick={() => onChatToggle(true)} />}
      </section>

      {/* Side Chat Panel */}
      <ChatSidePanel
        paperId={paperId}
        isOpen={isChatOpen}
        onToggle={onChatToggle}
        selection={chatSelection}
        onSelectionClear={onChatSelectionClear}
        onLocalAgentChange={setLocalAgent}
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
