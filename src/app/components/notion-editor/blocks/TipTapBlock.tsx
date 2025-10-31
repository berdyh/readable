"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { clsx } from "clsx";
import type { Block, BlockType } from "../types";
import { SlashCommandExtension } from "../SlashCommand";
import { buildSlashCommandItems, type SlashCommandContext } from "../commands";

interface TipTapBlockProps {
  block: Block;
  blockType: BlockType;
  onUpdate: (content: string) => void;
  onEnter?: () => void;
  onBackspace?: () => void;
  onSlashCommand?: (query: string) => void;
  placeholder?: string;
  className?: string;
  editorRef?: RefObject<HTMLDivElement>;
  paperId?: string;
  onChangeBlockType?: (blockId: string, newType: BlockType) => void;
  onInsertBlock?: (type: BlockType, index: number, content?: string) => void;
  blockIndex?: number;
  onExecuteApi?: (command: string, params?: Record<string, unknown>) => Promise<void>;
  isLocked?: boolean; // If true, block is read-only (slash commands still work but won't insert in locked area)
}

export function TipTapBlock({
  block,
  blockType,
  onUpdate,
  onEnter,
  onBackspace,
  placeholder = "Type '/' for commands",
  className,
  paperId,
  onChangeBlockType,
  onInsertBlock,
  blockIndex = 0,
  onExecuteApi,
  isLocked = false,
}: TipTapBlockProps) {
  // Build slash command items using useMemo to avoid setState in effect
  const slashItems = useMemo(() => {
    const context: SlashCommandContext = {
      blockId: block.id,
      blockIndex,
      blockType,
      currentContent: block.content,
      paperId,
      onChangeBlockType,
      onInsertBlock,
      onExecuteApi,
    };
    return buildSlashCommandItems(context);
  }, [block.id, block.content, blockType, blockIndex, paperId, onChangeBlockType, onInsertBlock, onExecuteApi]);

  const editor = useEditor({
    editable: !isLocked, // Make editor read-only when locked
    extensions: [
      StarterKit.configure({
        // Disable default heading since we handle block types externally
        heading: false,
        paragraph: {
          HTMLAttributes: {
            class: "m-0",
          },
        },
        // Allow hard breaks (Shift+Enter) for multi-line text within a block
        hardBreak: {
          keepMarks: true,
        },
        // Keep text formatting - use default configs
        bold: {},
        italic: {},
        strike: {},
        code: {},
        // Enable lists for list block types - allows inline list editing with Enter
        bulletList:
          blockType === "bullet_list"
            ? {
                keepAttributes: false,
                keepMarks: true,
              }
            : false,
        orderedList:
          blockType === "number_list"
            ? {
                keepMarks: true,
              }
            : false,
        listItem:
          blockType === "bullet_list" || blockType === "number_list"
            ? {}
            : false,
      }),
      Placeholder.configure({
        placeholder,
      }),
      SlashCommandExtension.configure({
        getItems: () => slashItems,
        // Slash commands work even in locked blocks, but won't insert in locked area
        // They will insert after the locked block instead
      }),
    ],
    content: block.content || "",
    editorProps: {
      attributes: {
        class: clsx(
          "outline-none",
          blockType === "heading_1" && "text-3xl font-bold mt-6 mb-4",
          blockType === "heading_2" && "text-2xl font-bold mt-5 mb-3",
          blockType === "heading_3" && "text-xl font-semibold mt-4 mb-2",
          blockType === "paragraph" && "text-[15px] leading-relaxed",
          blockType === "code" && "font-mono text-sm",
          blockType === "quote" && "italic text-neutral-600 dark:text-neutral-400",
          className,
        ),
      },
      // Prevent TipTap from handling drops when we're dragging blocks for reordering
      handleDrop: (view, event, _slice, moved) => {
        // Check if this is a block reordering drag (has our custom data type)
        const dragData = (event as DragEvent).dataTransfer;
        if (dragData) {
          const isBlockReorder = dragData.getData("application/x-block-reorder") === "true";
          // If this is a block reordering drag, prevent TipTap from handling it
          // The block-level handler will take care of reordering
          if (isBlockReorder) {
            event.preventDefault();
            event.stopPropagation();
            return true; // Signal that we handled this event, prevent TipTap from inserting text
          }
        }
        // For other drops (e.g., files, text), let TipTap handle normally
        return false;
      },
      handleKeyDown: (view, event) => {
        // In locked blocks, only allow slash commands, no other editing
        if (isLocked) {
          // Allow "/" to trigger slash commands (but commands insert after locked block)
          if (event.key === "/") {
            return false; // Let slash command extension handle it
          }
          // Prevent all other key interactions in locked blocks
          return true; // Prevent default behavior
        }

        // Handle Enter key (without Shift) - creates new block at end, allows inline editing otherwise
        if (event.key === "Enter" && !event.shiftKey) {
          const { from } = view.state.selection;
          const doc = view.state.doc;
          const isAtEnd = from === doc.content.size;
          
          // For list blocks (to-do, bullet, number), always create new block of same type
          // This matches Notion's behavior where Enter creates a new item of the same type
          if (blockType === "to_do_list" || blockType === "bullet_list" || blockType === "number_list") {
            event.preventDefault();
            onEnter?.();
            return true;
          }
          
          // For code blocks, always allow Enter to create new lines within the block
          if (blockType === "code") {
            // Let TipTap handle Enter normally (creates line breaks)
            return false;
          }
          
          // For paragraph/heading/quote/callout blocks, allow inline editing with Enter (line breaks)
          // Only create new block when at the very end of content
          if (
            blockType === "paragraph" ||
            blockType === "heading_1" ||
            blockType === "heading_2" ||
            blockType === "heading_3" ||
            blockType === "quote" ||
            blockType === "callout"
          ) {
            // At end of content - create new block for new paragraph/heading
            if (isAtEnd && doc.textContent.trim().length > 0) {
              event.preventDefault();
              onEnter?.();
              return true;
            }
            // Otherwise let TipTap handle Enter normally (creates line breaks for inline editing)
            return false;
          }
        }

        // Handle Shift+Enter - always create new block of same type (like plus button)
        if (event.key === "Enter" && event.shiftKey) {
          // For code blocks, Shift+Enter should still create line breaks
          if (blockType === "code") {
            return false; // Let TipTap handle it (creates line break)
          }
          
          // For all other blocks, Shift+Enter creates a new block of the same type
          event.preventDefault();
          onEnter?.();
          return true;
        }

        // Handle Backspace - delete block if empty
        if (event.key === "Backspace" || event.key === "Delete") {
          const textContent = view.state.doc.textContent.trim();
          // If block is empty (no text content), delete it
          if (textContent.length === 0) {
            event.preventDefault();
            onBackspace?.();
            return true;
          }
          // If at start of non-empty content, also allow delete (will merge with previous)
          const { from } = view.state.selection;
          if (from === 0 && event.key === "Backspace") {
            event.preventDefault();
            onBackspace?.();
            return true;
          }
        }

        // Handle "/" for slash commands - let it through normally
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      // Don't update if block is locked (read-only)
      if (isLocked) {
        return;
      }
      
      const html = editor.getHTML();
      const textContent = editor.getText().trim();
      
      // If content is empty, update to empty string (not "<p></p>")
      if (textContent.length === 0) {
        onUpdate("");
      } else {
        onUpdate(html);
      }
    },
    immediatelyRender: false,
  });

  // Sync editable state when lock status changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!isLocked);
    }
  }, [editor, isLocked]);

  // Sync content when block changes externally
  useEffect(() => {
    if (editor && editor.getHTML() !== block.content) {
      editor.commands.setContent(block.content || "", false);
    }
  }, [block.content, editor]);

  // Focus editor when block is selected or when it becomes empty placeholder
  useEffect(() => {
    if (editor && block.id === "placeholder" && !block.content) {
      // Auto-focus placeholder blocks
      setTimeout(() => {
        editor.commands.focus("end");
      }, 50);
    }
  }, [editor, block.id, block.content]);

  if (!editor) {
    return null;
  }

  return (
    <div className="w-full">
      <EditorContent editor={editor} />
    </div>
  );
}

