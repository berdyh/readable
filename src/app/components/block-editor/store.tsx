"use client";

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";
import { v4 as uuidv4 } from "uuid";

import type { Block, EditorState } from "./types";

export interface BlockFocusApi {
  focus: (position?: "start" | "end") => boolean;
}

interface EditorContextValue {
  state: EditorState;
  addBlock: (type: Block["type"], index: number, content?: string) => Block;
  updateBlock: (blockId: string, updates: Partial<Block>) => void;
  deleteBlock: (blockId: string) => void;
  moveBlock: (blockId: string, toIndex: number) => void;
  insertBlock: (block: Block, index: number) => void;
  changeBlockType: (blockId: string, newType: Block["type"]) => void;
  setBlocks: (blocks: Block[]) => void;
  getBlock: (blockId: string) => Block | undefined;
  registerBlockFocusApi: (blockId: string, api: BlockFocusApi) => void;
  unregisterBlockFocusApi: (blockId: string) => void;
  focusBlock: (blockId: string, position?: "start" | "end") => void;
}



function scheduleFocusRetry(
  focusFn: () => boolean,
  onExhausted: () => void,
  retries = 5,
) {
  const tryFocus = (attempt: number) => {
    if (focusFn()) {
      return;
    }

    if (attempt >= retries) {
      onExhausted();
      return;
    }

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => tryFocus(attempt + 1));
      return;
    }

    setTimeout(() => tryFocus(attempt + 1), 0);
  };

  tryFocus(0);
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
  const [blocks, setBlocksState] = useState<Block[]>(initialBlocks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blockFocusApisRef = useRef<Map<string, BlockFocusApi>>(new Map());
  const pendingFocusRef = useRef<{ blockId: string; position: "start" | "end" } | null>(null);

  // Sync blocks when initialBlocks change (e.g., when HTML/summary loads)
  // This ensures that when ReaderWorkspace loads HTML or summary content,
  // the blocks are updated in the editor
  useEffect(() => {
    setBlocksState(initialBlocks);
  }, [initialBlocks]);

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
      const newBlock: Block = {
        id: uuidv4(),
        type,
        content,
        metadata:
          type === "to_do_list"
            ? { checked: false }
            : undefined,
      };

      setBlocksState((prev) => {
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
      setBlocksState((prev) => {
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
      setBlocksState((prev) => {
        const updated = prev.filter((block) => block.id !== blockId);
        void saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  const moveBlock = useCallback(
    (blockId: string, toIndex: number) => {
      setBlocksState((prev) => {
        const fromIndex = prev.findIndex((block) => block.id === blockId);
        if (fromIndex === -1) {
          return prev;
        }

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
      setBlocksState((prev) => {
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

  const registerBlockFocusApi = useCallback((blockId: string, api: BlockFocusApi) => {
    blockFocusApisRef.current.set(blockId, api);
    if (pendingFocusRef.current?.blockId === blockId) {
      const { position } = pendingFocusRef.current;
      pendingFocusRef.current = null;

      scheduleFocusRetry(
        () => api.focus(position),
        () => {
          pendingFocusRef.current = { blockId, position };
        },
      );
    }
  }, []);

  const unregisterBlockFocusApi = useCallback((blockId: string) => {
    blockFocusApisRef.current.delete(blockId);
  }, []);

  const focusBlock = useCallback((blockId: string, position: "start" | "end" = "end") => {
    const api = blockFocusApisRef.current.get(blockId);
    if (api) {
      pendingFocusRef.current = null;
      scheduleFocusRetry(
        () => api.focus(position),
        () => {
          pendingFocusRef.current = { blockId, position };
        },
      );
      return;
    }

    pendingFocusRef.current = { blockId, position };
  }, []);


  const changeBlockType = useCallback(
    (blockId: string, newType: Block["type"]) => {
      setBlocksState((prev) => {
        const updated = prev.map((block) => {
          if (block.id === blockId) {
            // Preserve metadata for to-do lists
            const metadata = newType === "to_do_list" 
              ? { ...block.metadata, checked: false }
              : undefined;
            
            const content = block.content || "";
            
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

  const setBlocks = useCallback(
    (newBlocks: Block[]) => {
      setBlocksState(newBlocks);
      void saveToBackend(newBlocks);
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
    registerBlockFocusApi,
    unregisterBlockFocusApi,
    focusBlock,
  };

  return (
    <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
  );
}
