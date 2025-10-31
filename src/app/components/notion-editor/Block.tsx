"use client";

import {
  useState,
  useCallback,
} from "react";
import { clsx } from "clsx";
import { GripVertical, Plus, Edit2, Lock } from "lucide-react";

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
  const { state, updateBlock, deleteBlock, addBlock, changeBlockType, insertBlock, moveBlock } = useEditorStore();
  const [isFocused, setIsFocused] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const isLocked = block.metadata?.locked === true;

  // Handler for API execution from slash commands
  const handleExecuteApi = useCallback(
    async (command: string, params?: Record<string, unknown>) => {
      const { executeApiCommand } = await import("./apiHandlers");
      
      // Insert blocks after the current block index
      await executeApiCommand(command, {
        paperId: state.paperId,
        blockIndex: index + 1,
        onInsertBlocks: (blocks: Block[], insertIndex?: number) => {
          // Use provided insertIndex if available, otherwise use index + 1 (after current block)
          const startIndex = insertIndex !== undefined ? insertIndex : index + 1;
          // Insert all blocks at the specified index
          blocks.forEach((newBlock, offset) => {
            insertBlock(newBlock, startIndex + offset);
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

  const handleEnter = useCallback((markDone?: boolean) => {
    // Mark current block as done if it's a todo or list and markDone is true
    if (markDone && (block.type === "to_do_list" || block.type === "bullet_list" || block.type === "number_list")) {
      updateBlock(block.id, {
        metadata: { ...block.metadata, checked: true },
      });
    }
    
    // Create new block of the same type
    const newBlockType = block.type;
    const newBlock = addBlock(newBlockType, index);
    
    // Focus the new block after a short delay
    setTimeout(() => {
      const nextBlockElement = document.querySelector(
        `[data-block-id="${newBlock.id}"] .ProseMirror`,
      ) as HTMLElement;
      if (nextBlockElement) {
        nextBlockElement.focus();
      }
    }, 0);
  }, [addBlock, block.type, block.id, block.metadata, index, updateBlock]);

  const handleBackspace = useCallback(() => {
    const blockContent = block.content?.trim() || "";
    const textContent = blockContent
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&[a-zA-Z]+;/g, "")
      .trim();
    
    const isEmpty = 
      blockContent.length === 0 || 
      blockContent === "<p></p>" || 
      blockContent === "<p><br></p>" ||
      blockContent === "<br>" ||
      textContent.length === 0;
    
    // If todo block is empty, convert to paragraph instead of deleting
    if (isEmpty && block.type === "to_do_list") {
      changeBlockType(block.id, "paragraph");
      setTimeout(() => {
        const blockElement = document.querySelector(
          `[data-block-id="${block.id}"] .ProseMirror`,
        ) as HTMLElement;
        if (blockElement) {
          blockElement.focus();
        }
      }, 0);
      return;
    }
    
    if (isEmpty) {
      if (index > 0) {
        const prevBlockElement = document.querySelector(
          `[data-block-id="${block.id}"]`,
        )?.previousElementSibling as HTMLElement;
        
        if (prevBlockElement) {
          const prevTipTap = prevBlockElement.querySelector(".ProseMirror") as HTMLElement;
          if (prevTipTap) {
            prevTipTap.focus();
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
      const prevBlockElement = document.querySelector(
        `[data-block-id="${block.id}"]`,
      )?.previousElementSibling as HTMLElement;
      
      if (prevBlockElement) {
        const prevTipTap = prevBlockElement.querySelector(".ProseMirror") as HTMLElement;
        if (prevTipTap) {
          prevTipTap.focus();
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
  }, [block.id, block.content, block.type, deleteBlock, index, changeBlockType]);

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

  const handleToggleLock = useCallback(() => {
    updateBlock(block.id, {
      metadata: {
        ...block.metadata,
        locked: !isLocked,
      },
    });
  }, [block.id, block.metadata, isLocked, updateBlock]);

  // Drag and drop handlers
  const handleDragStart = useCallback((e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", block.id);
    e.dataTransfer.setData("application/block-index", index.toString());
    // Set a custom data type to identify this as a block reordering drag
    e.dataTransfer.setData("application/x-block-reorder", "true");
    // Prevent TipTap editors from accepting this drop
    e.stopPropagation();
    // Add visual feedback
    if (e.dataTransfer.setDragImage) {
      const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
      dragImage.style.opacity = "0.5";
      dragImage.style.transform = "rotate(2deg)";
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  }, [block.id, index]);

  const handleDragEnd = useCallback(() => {
    setIsDragging(false);
    setDragOver(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragOver to false if we're leaving the block itself, not a child
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX;
    const y = e.clientY;
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    setIsDragging(false);

    // Check if this is a block reordering drag (not a file/text drop)
    const isBlockReorder = e.dataTransfer.getData("application/x-block-reorder") === "true";
    if (!isBlockReorder) {
      // This is not a block reorder, let TipTap handle it (file drops, etc.)
      return;
    }

    const draggedBlockId = e.dataTransfer.getData("text/plain");
    const draggedIndex = parseInt(e.dataTransfer.getData("application/block-index"), 10);

    if (draggedBlockId && draggedBlockId !== block.id && !isNaN(draggedIndex) && draggedIndex !== index) {
      // Calculate the target index based on mouse position
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY;
      const midPoint = rect.top + rect.height / 2;
      const targetIndex = y < midPoint ? index : index + 1;

      // Adjust target index if dragging from above
      const finalTargetIndex = draggedIndex < targetIndex ? targetIndex - 1 : targetIndex;

      moveBlock(draggedBlockId, draggedIndex, finalTargetIndex);
    }
  }, [block.id, index, moveBlock]);

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
            isLocked={isLocked}
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
            isLocked={isLocked}
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
            isLocked={isLocked}
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
            isLocked={isLocked}
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
            isLocked={isLocked}
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
            isLocked={isLocked}
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
            isLocked={isLocked}
          />
        );
    }
  };

  return (
    <div
      className={clsx(
        "group relative flex items-start gap-2 rounded-md px-2 py-1 transition",
        isFocused && "bg-neutral-50 dark:bg-neutral-900",
        isDragging && "opacity-50",
        dragOver && "ring-2 ring-blue-500 dark:ring-blue-400",
      )}
      data-block-id={block.id}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      draggable={false}
    >
      {/* Lock/Edit toggle button - always in top-right corner */}
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity z-10">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation(); // Prevent event bubbling
            handleToggleLock();
          }}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors"
          title={isLocked ? "Click to unlock and edit" : "Click to lock (make read-only)"}
        >
          {isLocked ? (
            <Edit2 className="h-4 w-4 text-neutral-400" />
          ) : (
            <Lock className="h-4 w-4 text-neutral-400" />
          )}
        </button>
      </div>

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
            draggable
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
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
