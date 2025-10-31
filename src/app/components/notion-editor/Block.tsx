"use client";

import {
  useState,
  useCallback,
} from "react";
import { clsx } from "clsx";
import { GripVertical, Plus } from "lucide-react";

import { useEditorStore } from "./store";
import type { Block as BlockType, Block } from "./types";
import type { QuestionSelection } from "@/server/qa/types";
import { TextBlock } from "./blocks/TextBlock";
import { HeadingBlock } from "./blocks/HeadingBlock";
import { ListBlock } from "./blocks/ListBlock";
import { TodoBlock } from "./blocks/TodoBlock";
import { CodeBlock } from "./blocks/CodeBlock";
import { QuoteBlock } from "./blocks/QuoteBlock";
import { DividerBlock } from "./blocks/DividerBlock";
import { CalloutBlock } from "./blocks/CalloutBlock";
import { ChatMessageBlock } from "./blocks/ChatMessageBlock";

interface BlockProps {
  block: BlockType;
  index: number;
  onSlashCommand?: (query: string, blockIndex: number) => void;
}

export function Block({ block, index, onSlashCommand }: BlockProps) {
  const { state, updateBlock, deleteBlock, addBlock, changeBlockType, insertBlock } = useEditorStore();
  const [isFocused, setIsFocused] = useState(false);
  const [showOptions, setShowOptions] = useState(false);

  // Handler for API execution from slash commands
  const handleExecuteApi = useCallback(
    async (command: string, params?: Record<string, unknown>) => {
      const { executeApiCommand } = await import("./apiHandlers");
      
      // Insert blocks after the current block index
      await executeApiCommand(command, {
        paperId: state.paperId,
        blockIndex: index + 1,
        onInsertBlocks: (blocks: Block[]) => {
          // Insert all blocks after current block
          blocks.forEach((newBlock, offset) => {
            insertBlock(newBlock, index + 1 + offset);
          });
        },
        selection: params?.selection as QuestionSelection | undefined,
        userId: params?.userId as string | undefined,
        personaId: params?.personaId as string | undefined,
      });
    },
    [state.paperId, index, insertBlock],
  );

  const handleUpdate = useCallback(
    (content: string) => {
      updateBlock(block.id, { content });
    },
    [block.id, updateBlock],
  );

  const handleEnter = useCallback(() => {
    // Create new block based on current block type (like Notion)
    let newBlockType: BlockType["type"] = "paragraph";
    
    // For list blocks, create new block of same type
    if (block.type === "to_do_list" || block.type === "bullet_list" || block.type === "number_list") {
      newBlockType = block.type;
    }
    
    // Create new block after current block
    const newBlock = addBlock(newBlockType, index);
    
    // Focus the new block after a short delay
    setTimeout(() => {
      // Find and focus the TipTap editor in the new block
      const nextBlockElement = document.querySelector(
        `[data-block-id="${newBlock.id}"] .ProseMirror`,
      ) as HTMLElement;
      if (nextBlockElement) {
        nextBlockElement.focus();
      }
    }, 0);
  }, [addBlock, block.type, index]);

  const handleBackspace = useCallback(() => {
    // Check if block is empty
    // TipTap might return empty HTML like "<p></p>" or just empty string
    const blockContent = block.content?.trim() || "";
    const isEmpty = 
      blockContent.length === 0 || 
      blockContent === "<p></p>" || 
      blockContent === "" ||
      blockContent === "<p><br></p>" ||
      blockContent === "<br>" ||
      // Check if it's just HTML tags with no text
      (blockContent.startsWith("<p") && blockContent.endsWith("</p>") && !blockContent.match(/[^<>]/));
    
    if (isEmpty) {
      // If there's a previous block, focus it
      if (index > 0) {
        const prevBlockElement = document.querySelector(
          `[data-block-id="${block.id}"]`,
        )?.previousElementSibling as HTMLElement;
        
        if (prevBlockElement) {
          const prevTipTap = prevBlockElement.querySelector(".ProseMirror") as HTMLElement;
          if (prevTipTap) {
            prevTipTap.focus();
            // Move cursor to end of previous block
            setTimeout(() => {
              const range = document.createRange();
              const sel = window.getSelection();
              range.selectNodeContents(prevTipTap);
              range.collapse(false);
              sel?.removeAllRanges();
              sel?.addRange(range);
            }, 0);
          }
        }
      }
      
      deleteBlock(block.id);
    } else if (index > 0) {
      // Block has content and backspace at start - merge with previous
      const prevBlockElement = document.querySelector(
        `[data-block-id="${block.id}"]`,
      )?.previousElementSibling as HTMLElement;
      
      if (prevBlockElement) {
        const prevTipTap = prevBlockElement.querySelector(".ProseMirror") as HTMLElement;
        if (prevTipTap) {
          prevTipTap.focus();
          // Move cursor to end of previous block
          setTimeout(() => {
            const range = document.createRange();
            const sel = window.getSelection();
            range.selectNodeContents(prevTipTap);
            range.collapse(false);
            sel?.removeAllRanges();
            sel?.addRange(range);
          }, 0);
        }
      }
      
      deleteBlock(block.id);
    }
  }, [block.id, block.content, deleteBlock, index]);

  const handleSlashCommand = useCallback(
    (query: string) => {
      onSlashCommand?.(query, index);
    },
    [index, onSlashCommand],
  );

  const handleAddClick = useCallback(() => {
    // Add same type of block (like Notion)
    addBlock(block.type, index);
    setShowOptions(false);
  }, [addBlock, block.type, index]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    setShowOptions(true);
  }, []);

  const handleBlur = useCallback(() => {
    // Delay to allow focus to move to new block if clicking add button
    setTimeout(() => {
      setIsFocused(false);
      setShowOptions(false);
    }, 200);
  }, []);

  // Render appropriate block component based on type
  const renderBlock = () => {
    switch (block.type) {
      case "heading_1":
      case "heading_2":
      case "heading_3":
        return (
          <HeadingBlock
            block={block}
            onUpdate={handleUpdate}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
            onSlashCommand={handleSlashCommand}
            paperId={state.paperId}
            blockIndex={index}
            onChangeBlockType={changeBlockType}
            onInsertBlock={(type, idx, content) => {
              const newBlock = addBlock(type, idx, content);
              insertBlock(newBlock, idx);
            }}
            onExecuteApi={handleExecuteApi}
          />
        );
      case "bullet_list":
      case "number_list":
        return (
          <ListBlock
            block={block}
            index={index}
            onUpdate={handleUpdate}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
            onSlashCommand={handleSlashCommand}
            paperId={state.paperId}
            blockIndex={index}
            onChangeBlockType={changeBlockType}
            onInsertBlock={(type, idx, content) => {
              const newBlock = addBlock(type, idx, content);
              insertBlock(newBlock, idx);
            }}
            onExecuteApi={handleExecuteApi}
          />
        );
      case "to_do_list":
        return (
          <TodoBlock
            block={block}
            onUpdate={handleUpdate}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
            onSlashCommand={handleSlashCommand}
            updateBlock={updateBlock}
            paperId={state.paperId}
            blockIndex={index}
            onChangeBlockType={changeBlockType}
            onInsertBlock={(type, idx, content) => {
              const newBlock = addBlock(type, idx, content);
              insertBlock(newBlock, idx);
            }}
            onExecuteApi={handleExecuteApi}
          />
        );
      case "code":
        return (
          <CodeBlock
            block={block}
            onUpdate={handleUpdate}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
            onSlashCommand={handleSlashCommand}
            paperId={state.paperId}
            blockIndex={index}
            onChangeBlockType={changeBlockType}
            onInsertBlock={(type, idx, content) => {
              const newBlock = addBlock(type, idx, content);
              insertBlock(newBlock, idx);
            }}
            onExecuteApi={handleExecuteApi}
          />
        );
      case "quote":
        return (
          <QuoteBlock
            block={block}
            onUpdate={handleUpdate}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
            onSlashCommand={handleSlashCommand}
            paperId={state.paperId}
            blockIndex={index}
            onChangeBlockType={changeBlockType}
            onInsertBlock={(type, idx, content) => {
              const newBlock = addBlock(type, idx, content);
              insertBlock(newBlock, idx);
            }}
            onExecuteApi={handleExecuteApi}
          />
        );
      case "divider":
        return <DividerBlock block={block} />;
      case "callout":
        return (
          <CalloutBlock
            block={block}
            onUpdate={handleUpdate}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
            onSlashCommand={handleSlashCommand}
            paperId={state.paperId}
            blockIndex={index}
            onChangeBlockType={changeBlockType}
            onInsertBlock={(type, idx, content) => {
              const newBlock = addBlock(type, idx, content);
              insertBlock(newBlock, idx);
            }}
            onExecuteApi={handleExecuteApi}
          />
        );
      case "chat_message":
        return (
          <ChatMessageBlock
            block={block}
            onUpdate={handleUpdate}
            onBackspace={handleBackspace}
            paperId={state.paperId}
            onInsertBlocks={(blocks) => {
              blocks.forEach((b, i) => {
                insertBlock(b, index + 1 + i);
              });
            }}
            onDelete={() => deleteBlock(block.id)}
          />
        );
      default:
        return (
          <TextBlock
            block={block}
            onUpdate={handleUpdate}
            onEnter={handleEnter}
            onBackspace={handleBackspace}
            onSlashCommand={handleSlashCommand}
            paperId={state.paperId}
            blockIndex={index}
            onChangeBlockType={changeBlockType}
            onInsertBlock={(type, idx, content) => {
              const newBlock = addBlock(type, idx, content);
              insertBlock(newBlock, idx);
            }}
            onExecuteApi={handleExecuteApi}
          />
        );
    }
  };

  return (
    <div
      className={clsx(
        "group relative flex items-start gap-2 rounded-md px-2 py-1 transition",
        isFocused && "bg-neutral-50 dark:bg-neutral-900",
      )}
      data-block-id={block.id}
      onFocus={handleFocus}
      onBlur={handleBlur}
    >
      {/* Block options (shown on hover/focus) */}
      {(isFocused || showOptions) && (
        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <button
            type="button"
            onClick={handleAddClick}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700"
            title="Add block"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 cursor-move"
            title="Drag to reorder"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Block content */}
      <div className="flex-1" onFocus={handleFocus}>{renderBlock()}</div>
    </div>
  );
}
