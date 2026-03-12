"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
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
import { FigureBlock } from "./blocks/FigureBlock";
import { getDeletionFocusTarget, isBlockContentEmpty, resolveDropReorder } from "./blockInteractionUtils";

interface BlockProps {
  block: BlockType;
  index: number;
  onSlashCommand?: (query: string, blockIndex: number) => void;
}

export function Block({ block, index, onSlashCommand }: BlockProps) {
  const {
    state,
    updateBlock,
    deleteBlock,
    addBlock,
    changeBlockType,
    insertBlock,
    moveBlock,
    registerBlockFocusApi,
    unregisterBlockFocusApi,
    focusBlock,
  } = useEditorStore();
  const [isFocused, setIsFocused] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isLocked = block.metadata?.locked === true;

  useEffect(() => {
    registerBlockFocusApi(block.id, {
      focus: (position = "end") => {
        const editorElement = containerRef.current?.querySelector(".ProseMirror") as HTMLElement | null;
        if (!editorElement) return false;

        editorElement.focus();
        const range = document.createRange();
        const selection = window.getSelection();
        range.selectNodeContents(editorElement);
        range.collapse(position === "start");
        selection?.removeAllRanges();
        selection?.addRange(range);
        return true;
      },
    });

    return () => unregisterBlockFocusApi(block.id);
  }, [block.id, registerBlockFocusApi, unregisterBlockFocusApi]);

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
    if (markDone && (block.type === "to_do_list" || block.type === "bullet_list" || block.type === "number_list")) {
      updateBlock(block.id, {
        metadata: { ...block.metadata, checked: true },
      });
    }

    const newBlock = addBlock(block.type, index);
    focusBlock(newBlock.id, "end");
  }, [addBlock, block.type, block.id, block.metadata, index, updateBlock, focusBlock]);

  const handleBackspace = useCallback((triggerKey?: "Backspace" | "Delete") => {
    const effectiveTriggerKey = triggerKey ?? "Backspace";
    const isEmpty = isBlockContentEmpty(block.content);

    if (isEmpty && (block.type === "to_do_list" || block.type === "bullet_list" || block.type === "number_list")) {
      changeBlockType(block.id, "paragraph");
      setTimeout(() => {
        focusBlock(block.id, "end");
      }, 0);
      return;
    }

    if (!isEmpty) {
      return;
    }

    const focusTarget = getDeletionFocusTarget(state.blocks, block.id, effectiveTriggerKey);
    deleteBlock(block.id);

    if (focusTarget) {
      focusBlock(focusTarget.blockId, focusTarget.position);
    }
  }, [block.id, block.content, block.type, state.blocks, deleteBlock, changeBlockType, focusBlock]);

  const handleSlashCommand = useCallback(
    (query: string) => {
      onSlashCommand?.(query, index);
    },
    [index, onSlashCommand],
  );

  const handleAddClick = useCallback(() => {
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

  const handleDragStart = useCallback((e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", block.id);
    e.dataTransfer.setData("application/x-block-reorder", "true");
    e.stopPropagation();
    if (e.dataTransfer.setDragImage) {
      const dragImage = e.currentTarget.cloneNode(true) as HTMLElement;
      dragImage.style.opacity = "0.5";
      dragImage.style.transform = "rotate(2deg)";
      document.body.appendChild(dragImage);
      e.dataTransfer.setDragImage(dragImage, 0, 0);
      setTimeout(() => document.body.removeChild(dragImage), 0);
    }
  }, [block.id]);

  const handleDragEnd = useCallback((e: React.DragEvent) => {
    setIsDragging(false);
    setDragOver(false);
    e.preventDefault();
    e.stopPropagation();
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

    const isBlockReorder = e.dataTransfer.getData("application/x-block-reorder") === "true";
    if (!isBlockReorder) return;

    const draggedBlockId = e.dataTransfer.getData("text/plain");
    if (!draggedBlockId || draggedBlockId === block.id) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midPoint = rect.top + rect.height / 2;
    const dropPosition = e.clientY < midPoint ? "before" : "after";
    const reorder = resolveDropReorder(state.blocks, draggedBlockId, block.id, dropPosition);
    if (!reorder) return;

    moveBlock(draggedBlockId, reorder.toIndex);
  }, [block.id, moveBlock, state.blocks]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    setShowOptions(true);
  }, []);

  const handleBlur = useCallback(() => {
    setTimeout(() => {
      setIsFocused(false);
      setShowOptions(false);
    }, 200);
  }, []);

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
              addBlock(type, idx, content);
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
              addBlock(type, idx, content);
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
              addBlock(type, idx, content);
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
              addBlock(type, idx, content);
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
              addBlock(type, idx, content);
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
              addBlock(type, idx, content);
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
      case "figure":
        return (
          <FigureBlock
            block={block}
            paperId={state.paperId}
            isLocked={isLocked}
            onUpdate={handleUpdate}
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
              addBlock(type, idx, content);
            }}
            onExecuteApi={handleExecuteApi}
            isLocked={isLocked}
          />
        );
    }
  };

  return (
    <div
      ref={containerRef}
      className={clsx(
        "group relative flex items-start gap-2 rounded-md px-2 py-1 transition-all duration-150",
        "hover:bg-neutral-50/50 dark:hover:bg-neutral-900/50",
        isFocused && !isDragging && "bg-neutral-50 dark:bg-neutral-900",
        isDragging && "opacity-50 pointer-events-none scale-[0.98]",
        dragOver && "ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50/50 dark:bg-blue-950/30",
      )}
      data-block-id={block.id}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      draggable={false}
    >
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-10">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleLock();
          }}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-95 transition-all duration-150 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
          title={isLocked ? "Click to unlock and edit" : "Click to lock (make read-only)"}
        >
          {isLocked ? (
            <Edit2 className="h-4 w-4" />
          ) : (
            <Lock className="h-4 w-4" />
          )}
        </button>
      </div>

      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
        {(isFocused || showOptions) && (
          <button
            type="button"
            onClick={handleAddClick}
            className="flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-95 transition-all duration-150 text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 pointer-events-auto"
            title="Add block"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          draggable
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 active:scale-95 transition-all duration-150 cursor-move text-neutral-500 dark:text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 pointer-events-auto"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1" onFocus={handleFocus}>{renderBlock()}</div>
    </div>
  );
}