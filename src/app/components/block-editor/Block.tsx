"use client";

import { useState, useCallback, useRef, useEffect } from "react";
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
import {
  getDeletionFocusTarget,
  isBlockContentEmpty,
  isFullBleedBlock,
} from "./blockInteractionUtils";
import { executeApiCommand } from "./apiHandlers";
import { useBlockDragAndDrop } from "./useBlockDragAndDrop";

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
    getLocalAgent,
  } = useEditorStore();
  const [isFocused, setIsFocused] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isLocked = block.metadata?.locked === true;

  const { isDragging, dragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop } =
    useBlockDragAndDrop({ blockId: block.id, blocks: state.blocks, moveBlock });

  useEffect(() => {
    registerBlockFocusApi(block.id, {
      focus: (position = "end") => {
        const editorElement = containerRef.current?.querySelector(
          ".ProseMirror",
        ) as HTMLElement | null;
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
        target: params?.target as string | undefined,
        localAgent: getLocalAgent(),
      });
    },
    [state.paperId, index, insertBlock, getLocalAgent],
  );

  const handleUpdate = useCallback(
    (content: string) => {
      updateBlock(block.id, { content });
    },
    [block.id, updateBlock],
  );

  const handleEnter = useCallback(
    (markDone?: boolean) => {
      if (
        markDone &&
        (block.type === "to_do_list" ||
          block.type === "bullet_list" ||
          block.type === "number_list")
      ) {
        updateBlock(block.id, {
          metadata: { ...block.metadata, checked: true },
        });
      }

      const newBlock = addBlock(block.type, index);
      focusBlock(newBlock.id, "end");
    },
    [addBlock, block.type, block.id, block.metadata, index, updateBlock, focusBlock],
  );

  const handleBackspace = useCallback(
    (triggerKey?: "Backspace" | "Delete") => {
      const effectiveTriggerKey = triggerKey ?? "Backspace";
      const isEmpty = isBlockContentEmpty(block.content);

      if (
        isEmpty &&
        (block.type === "to_do_list" ||
          block.type === "bullet_list" ||
          block.type === "number_list")
      ) {
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
    },
    [block.id, block.content, block.type, state.blocks, deleteBlock, changeBlockType, focusBlock],
  );

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
        return <DividerBlock />;
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
        return <FigureBlock block={block} paperId={state.paperId} isLocked={isLocked} />;
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
        "hover:bg-zinc-50/50 dark:hover:bg-zinc-900/50",
        isFocused && !isDragging && "bg-zinc-50 dark:bg-zinc-900",
        isDragging && "opacity-50 pointer-events-none scale-[0.98]",
        dragOver && "ring-2 ring-blue-500 dark:ring-blue-400 bg-blue-50/50 dark:bg-blue-950/30",
      )}
      data-block-id={block.id}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      draggable={false}
    >
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 z-10">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleToggleLock();
          }}
          className="touch-target relative flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 transition-all duration-150 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          title={isLocked ? "Click to unlock and edit" : "Click to lock (make read-only)"}
        >
          {isLocked ? <Edit2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 pointer-events-none group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
        {(isFocused || showOptions) && (
          <button
            type="button"
            onClick={handleAddClick}
            className="touch-target relative flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 transition-all duration-150 text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 pointer-events-auto"
            title="Add block"
          >
            <Plus className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          draggable
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          className="touch-target relative flex h-6 w-6 items-center justify-center rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 active:scale-95 transition-all duration-150 cursor-move text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 pointer-events-auto"
          title="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      </div>

      {/* min-w-0: without it a flex item's automatic minimum size is its
          min-content width, so one long unbreakable token in a paper (inline
          LaTeX, a URL) widens the whole page and the phone scrolls sideways. */}
      <div className="min-w-0 flex-1" onFocus={handleFocus}>
        {/* Prose is capped at a ~70ch measure. Past roughly that width the eye
            loses the start of the next line on the return sweep, which is the
            single thing that makes a long paper tiring to read.

            It cannot be a blanket cap on the column, because the blocks in
            FULL_BLEED_BLOCK_TYPES are not prose: a figure narrowed to 70ch is
            unreadable, and a rule that stops short of the column edge reads as
            a rendering bug rather than a divider. */}
        <div className={isFullBleedBlock(block.type) ? undefined : "max-w-[70ch]"}>
          {renderBlock()}
        </div>
      </div>
    </div>
  );
}
