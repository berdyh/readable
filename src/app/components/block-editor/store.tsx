"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { v4 as uuidv4 } from "uuid";

import type { Block, EditorState } from "./types";

interface EditorContextValue {
  state: EditorState;
  addBlock: (type: Block["type"], index: number, content?: string) => Block;
  updateBlock: (blockId: string, updates: Partial<Block>) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, fromIndex: number, toIndex: number) => void;
  insertBlock: (block: Block, index: number) => void;
  changeBlockType: (blockId: string, newType: Block["type"]) => void;
  setBlocks: (blocks: Block[]) => void;
  getBlock: (blockId: string) => Block | undefined;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorStore() {
  const context = useContext(EditorContext);
  if (!context) {
    throw new Error("useEditorStore must be used within EditorProvider");
  }
  return context;
}

interface EditorProviderProps {
  children: ReactNode;
  paperId: string;
  initialBlocks?: Block[];
}

export function EditorProvider({
  children,
  paperId,
  initialBlocks = [],
}: EditorProviderProps) {
  const [blocks, setBlocks] = useState<Block[]>(initialBlocks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const state: EditorState = {
    blocks,
    paperId,
    loading,
    error,
  };

  // Debounced save to backend
  const saveToBackend = useCallback(
    async (_blocksToSave: Block[]) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(async () => {
        setLoading(true);
        try {
          // TODO: Implement API call to save blocks
          // await fetch(`/api/editor/blocks/${paperId}`, {
          //   method: "PUT",
          //   headers: { "Content-Type": "application/json" },
          //   body: JSON.stringify({ blocks: _blocksToSave }),
          // });
        } catch (err) {
          console.error("Failed to save blocks:", err);
          setError(
            err instanceof Error ? err.message : "Failed to save blocks",
          );
        } finally {
          setLoading(false);
        }
      }, 1000);
    },
    [],
  );

  const addBlock = useCallback(
    (type: Block["type"], index: number, content = ""): Block => {
      // Initialize todo blocks with markdown [ ] syntax
      const initialContent = type === "to_do_list" && !content ? "[ ] " : content;
      
      const newBlock: Block = {
        id: uuidv4(),
        type,
        content: initialContent,
        metadata:
          type === "to_do_list"
            ? { checked: false }
            : undefined,
      };

      setBlocks((prev) => {
        const updated = [...prev];
        updated.splice(index + 1, 0, newBlock);
        void saveToBackend(updated);
        return updated;
      });

      return newBlock;
    },
    [saveToBackend],
  );

  const updateBlock = useCallback(
    (blockId: string, updates: Partial<Block>) => {
      setBlocks((prev) => {
        const updated = prev.map((block) =>
          block.id === blockId ? { ...block, ...updates } : block,
        );
        void saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  const deleteBlock = useCallback(
    (blockId: string) => {
      setBlocks((prev) => {
        const updated = prev.filter((block) => block.id !== blockId);
        void saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  const moveBlock = useCallback(
    (blockId: string, fromIndex: number, toIndex: number) => {
      setBlocks((prev) => {
        const updated = [...prev];
        const [movedBlock] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, movedBlock);
        void saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  const insertBlock = useCallback(
    (block: Block, index: number) => {
      setBlocks((prev) => {
        const updated = [...prev];
        updated.splice(index, 0, block);
        void saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  const getBlock = useCallback(
    (blockId: string) => {
      return blocks.find((block) => block.id === blockId);
    },
    [blocks],
  );

  const changeBlockType = useCallback(
    (blockId: string, newType: Block["type"]) => {
      setBlocks((prev) => {
        const updated = prev.map((block) => {
          if (block.id === blockId) {
            // Preserve metadata for to-do lists
            const metadata = newType === "to_do_list" 
              ? { ...block.metadata, checked: false }
              : undefined;
            
            // Preserve content - convert inline if needed
            let content = block.content || "";
            
            // When converting to list blocks, remove any existing list markers from content
            if (newType === "bullet_list" || newType === "number_list") {
              // Remove markdown list markers if present
              content = content.replace(/^[\*\-\+]\s+/, "").replace(/^\d+\.\s+/, "").trim();
            }
            
            // When converting from list to paragraph, ensure clean text
            if (newType === "paragraph" && (block.type === "bullet_list" || block.type === "number_list")) {
              // Content should already be clean (no markers) from our markdown conversion
              // Just ensure it's trimmed
              content = content.trim();
            }
            
            return { ...block, type: newType, content, metadata };
          }
          return block;
        });
        void saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  const value: EditorContextValue = {
    state,
    addBlock,
    updateBlock,
    deleteBlock,
    moveBlock,
    insertBlock,
    changeBlockType,
    setBlocks,
    getBlock,
  };

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}

