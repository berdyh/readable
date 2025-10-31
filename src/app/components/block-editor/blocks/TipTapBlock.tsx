"use client";

import { useEffect, useMemo, type RefObject } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { clsx } from "clsx";
import type { Block, BlockType } from "../types";
import { SlashCommandExtension } from "../SlashCommand";
import { buildSlashCommandItems, type SlashCommandContext } from "../commands";
import { htmlToMarkdown, markdownToHtml } from "../utils/markdown";

interface TipTapBlockProps {
  block: Block;
  blockType: BlockType;
  onUpdate: (content: string) => void;
  onEnter?: (markDone?: boolean) => void;
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
  isLocked?: boolean;
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
        heading: false, // Block types handled externally
        paragraph: {
          HTMLAttributes: {
            class: "m-0",
          },
        },
        hardBreak: {
          keepMarks: true,
        },
        bold: {},
        italic: {},
        strike: {},
        code: {},
        // For list blocks, we handle the list structure externally (ListBlock component)
        // TipTap should just render the content as a paragraph, not as a nested list
        bulletList: false, // Disabled - ListBlock handles bullet display
        orderedList: false, // Disabled - ListBlock handles numbering
        listItem: false, // Disabled - each block is already a list item
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
    // Convert markdown to HTML for TipTap (TipTap works with HTML internally)
    content: block.content ? markdownToHtml(block.content, blockType) : "",
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
        if (isLocked) {
          if (event.key === "/") return false;
          return true;
        }

        // Detect markdown triggers when space is pressed
        if (event.key === " " && blockType === "paragraph" && onChangeBlockType) {
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(Math.max(0, from - 10), from);
          
          // Check if "* " or "- " or "+ " was just typed
          if (textBefore.match(/[\*\-\+]\s*$/) && from <= 3) {
            // Only trigger if at the very start (first few characters)
            const match = textBefore.match(/^[\*\-\+]$/);
            if (match) {
              event.preventDefault();
              // Delete the trigger character and space
              view.dispatch(
                view.state.tr.delete(from - 1, from).insertText("")
              );
              onChangeBlockType(block.id, "bullet_list");
              return true;
            }
          }
          
          // Check if "1. " or "1) " was just typed
          if (textBefore.match(/\d+[\.\)]\s*$/) && from <= 5) {
            const match = textBefore.match(/^\d+[\.\)]$/);
            if (match) {
              event.preventDefault();
              // Delete the trigger pattern and space
              const triggerLength = match[0].length;
              view.dispatch(
                view.state.tr.delete(from - triggerLength, from).insertText("")
              );
              onChangeBlockType(block.id, "number_list");
              return true;
            }
          }
        }

        // Handle Enter key (without modifiers) - creates new line in block (not new block)
        if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
          // Let TipTap handle Enter normally (creates line breaks)
          return false;
        }

        // Handle Shift+Enter - creates new block of same type
        if (event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.metaKey) {
          event.preventDefault();
          onEnter?.(false);
          return true;
        }

        // Handle Ctrl+Enter (or Cmd+Enter on Mac) - creates new block and marks done if todo/list
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          onEnter?.(true);
          return true;
        }

        // Handle Backspace/Delete - delegate to parent handler
        if (event.key === "Backspace" || event.key === "Delete") {
          const textContent = view.state.doc.textContent.trim();
          if (textContent.length === 0 || (event.key === "Backspace" && view.state.selection.from === 0)) {
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
      if (isLocked) return;
      
      const html = editor.getHTML();
      const textContent = editor.getText();
      
      // Detect markdown triggers at the start of the line
      // Only check for paragraph blocks (not already list blocks)
      if (blockType === "paragraph" && onChangeBlockType && textContent.length > 0) {
        // Get the full text (not trimmed) to check for triggers at the very start
        const fullText = editor.getText();
        const firstLine = fullText.split("\n")[0];
        
        // Check for bullet list trigger: "* ", "- ", or "+ " followed by space
        // Match at the very start of the document
        const bulletMatch = firstLine.match(/^[\*\-\+]\s+(.+)$/);
        if (bulletMatch) {
          const contentWithoutTrigger = bulletMatch[1].trim();
          onChangeBlockType(block.id, "bullet_list");
          // Update content without the trigger
          setTimeout(() => {
            if (contentWithoutTrigger) {
              editor.commands.setContent(markdownToHtml(contentWithoutTrigger, "bullet_list") || "", false);
            } else {
              editor.commands.setContent("", false);
            }
            editor.commands.focus("end");
          }, 0);
          return;
        }
        
        // Check for numbered list trigger: "1. ", "1) " etc followed by space
        const numberMatch = firstLine.match(/^\d+[\.\)]\s+(.+)$/);
        if (numberMatch) {
          const contentWithoutTrigger = numberMatch[1].trim();
          onChangeBlockType(block.id, "number_list");
          // Update content without the trigger
          setTimeout(() => {
            if (contentWithoutTrigger) {
              editor.commands.setContent(markdownToHtml(contentWithoutTrigger, "number_list") || "", false);
            } else {
              editor.commands.setContent("", false);
            }
            editor.commands.focus("end");
          }, 0);
          return;
        }
      }
      
      // Convert HTML back to Markdown for storage
      // Only convert if there's actual content
      if (textContent.trim().length === 0) {
        onUpdate("");
      } else {
        const markdown = htmlToMarkdown(html, blockType);
        onUpdate(markdown);
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
  // Convert markdown to HTML for TipTap
  useEffect(() => {
    if (editor) {
      const currentHtml = editor.getHTML();
      const expectedHtml = block.content ? markdownToHtml(block.content, blockType) : "";
      
      // Only update if content actually changed (avoid infinite loops)
      if (currentHtml !== expectedHtml) {
        editor.commands.setContent(expectedHtml || "", false);
      }
    }
  }, [block.content, blockType, editor]);

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

