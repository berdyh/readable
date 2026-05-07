"use client";

import { useEffect, useState } from "react";
import { clsx } from "clsx";
import { Loader2, AlertCircle } from "lucide-react";
import { EditorProvider, useEditorStore } from "./store";
import { Block } from "./Block";
import type { Block as BlockType } from "./types";
import { ChatButton, ChatSidePanel } from "./ChatIntegration";
import type { QuestionSelection } from "@/server/qa/types";

interface BlockEditorProps {
  paperId: string;
  initialBlocks?: BlockType[];
  onSlashCommand?: (query: string, blockIndex: number) => void;
  statusMessage?: string | null;
  errorMessage?: string | null;
  onStatusClear?: () => void;
  showChatButton?: boolean;
  userId?: string;
}

export function BlockEditor({
  paperId,
  initialBlocks = [],
  onSlashCommand,
  statusMessage,
  errorMessage,
  onStatusClear,
  showChatButton = true,
  userId,
}: BlockEditorProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatSelection, setChatSelection] = useState<QuestionSelection | undefined>(undefined);

  return (
    <EditorProvider paperId={paperId} initialBlocks={initialBlocks}>
      <BlockEditorContent
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
        userId={userId}
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

  // Handle block navigation from source clicks
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ page?: number; chunkId?: string; quote?: string; paperId: string }>).detail;
      if (!detail || detail.paperId !== paperId) {
        return;
      }

      // Helper to extract plain text from HTML
      const getPlainText = (html: string): string => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
      };

      // Helper to normalize text for comparison
      const normalizeText = (text: string): string => {
        return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
      };

      // Filter out divider blocks - they're not actual content blocks and shouldn't be navigated to
      const contentBlocks = state.blocks.filter((block) => block.type !== "divider");

      let targetBlock: BlockType | undefined;

      // Strategy 1: Direct chunkId match (most accurate for citations)
      if (detail.chunkId) {
        targetBlock = contentBlocks.find((block) => block.metadata?.chunkId === detail.chunkId);
      }

      // Strategy 2: Try to match by quote text
      if (!targetBlock && detail.quote) {
        const normalizedQuote = normalizeText(detail.quote);
        
        // Try exact match first
        targetBlock = contentBlocks.find((block) => {
          const blockText = normalizeText(getPlainText(block.content));
          return blockText.includes(normalizedQuote) || normalizedQuote.includes(blockText);
        });

        // If no exact match, try fuzzy match (check if quote contains key words from block)
        if (!targetBlock && normalizedQuote.length > 20) {
          const quoteWords = normalizedQuote.split(' ').filter(w => w.length > 3);
          
          // Only attempt fuzzy matching if we have qualifying words (length > 3)
          // If all words are 3 chars or less, skip fuzzy matching to avoid false positives
          if (quoteWords.length > 0) {
            // Require matching: 1 word if 1-2 words, up to 3 words if 3+ words available
            const minMatches = Math.min(3, quoteWords.length);
            
            targetBlock = contentBlocks.find((block) => {
              const blockText = normalizeText(getPlainText(block.content));
              // Check if required number of words from quote appear in block
              const matchingWords = quoteWords.filter(word => blockText.includes(word));
              return matchingWords.length >= minMatches;
            });
          }
        }
      }

      // Strategy 3: Fall back to page number matching
      if (!targetBlock && detail.page) {
        // Find exact page match
        targetBlock = contentBlocks.find((block) => block.metadata?.page === detail.page);
        
        // If no exact match, find closest page (within ±1)
        if (!targetBlock) {
          targetBlock = contentBlocks.find((block) => {
            const blockPage = block.metadata?.page;
            return blockPage && Math.abs(blockPage - detail.page!) <= 1;
          });
        }

        // If still no match, find first block with a page number >= target page
        if (!targetBlock) {
          targetBlock = contentBlocks.find((block) => {
            const blockPage = block.metadata?.page;
            return blockPage && blockPage >= detail.page!;
          });
        }
      }

      // Strategy 4: If we have chunkId but no direct match, try to find by section (chunks are organized by sections)
      if (!targetBlock && detail.chunkId) {
        // Chunk IDs often contain section info (e.g., "intro-p1" or "S1-p1")
        const sectionMatch = detail.chunkId.match(/^[A-Z]?\d+/);
        if (sectionMatch) {
          const sectionId = sectionMatch[0];
          targetBlock = contentBlocks.find((block) => 
            block.metadata?.section?.includes(sectionId) || 
            block.content.toLowerCase().includes(sectionId.toLowerCase())
          );
        }
      }
      
      if (targetBlock) {
        // Find the block element and scroll to it
        const blockElement = document.querySelector(`[data-block-id="${targetBlock.id}"]`);
        if (blockElement) {
          blockElement.scrollIntoView({ 
            behavior: "smooth", 
            block: "center",
            inline: "nearest"
          });
          
          // Add a temporary highlight effect
          blockElement.classList.add("ring-2", "ring-blue-500", "dark:ring-blue-400", "bg-blue-50/50", "dark:bg-blue-950/30");
          setTimeout(() => {
            blockElement.classList.remove("ring-2", "ring-blue-500", "dark:ring-blue-400", "bg-blue-50/50", "dark:bg-blue-950/30");
          }, 2000);
        }
      }
    };

    window.addEventListener("block-editor-navigate", handler);
    return () => window.removeEventListener("block-editor-navigate", handler);
  }, [state.blocks, paperId]);

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
      <div className={clsx("min-h-[400px] space-y-1 transition-opacity duration-200", state.loading && "opacity-50")}>
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
