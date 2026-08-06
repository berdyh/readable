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

import {
  blocksAreEquivalent,
  decideDocumentBlocks,
  recordDocumentBaseline,
  recordDocumentEdit,
  type DocumentEntries,
} from "./documentState";
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
  /**
   * The chat picker's local-agent pin, shared so slash commands hit the same
   * agent the user chose for chat. Ref-backed: a pick change must not
   * re-render every block, and commands only need the value at execute time.
   */
  setLocalAgent: (agentId: string | undefined) => void;
  getLocalAgent: () => string | undefined;
}

function scheduleFocusRetry(focusFn: () => boolean, onExhausted: () => void, retries = 5) {
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
  /**
   * Identifies which source document `initialBlocks` was parsed from — the
   * summary artifact, the paper HTML, or a placeholder. Edits are remembered
   * per key, so swapping documents (the three-pass toggle) no longer discards
   * them. Defaults to the paper id for callers that only ever render one
   * document.
   */
  documentKey?: string;
}

export function EditorProvider({
  children,
  paperId,
  initialBlocks = [],
  documentKey,
}: EditorProviderProps) {
  const resolvedDocumentKey = documentKey ?? paperId;
  const [blocks, setBlocksState] = useState<Block[]>(initialBlocks);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blockFocusApisRef = useRef<Map<string, BlockFocusApi>>(new Map());
  const pendingFocusRef = useRef<{ blockId: string; position: "start" | "end" } | null>(null);
  const localAgentRef = useRef<string | undefined>(undefined);
  // Per-source-document blocks + dirty flag. A ref, not state: it is written
  // from inside state updaters and only ever read when a document swaps in,
  // so it must never itself cause a render.
  const documentEntriesRef = useRef<DocumentEntries>(new Map());
  const documentKeyRef = useRef(resolvedDocumentKey);

  const setLocalAgent = useCallback((agentId: string | undefined) => {
    localAgentRef.current = agentId;
  }, []);

  const getLocalAgent = useCallback(() => localAgentRef.current, []);

  // Swap in the document `initialBlocks` belongs to. The parsers mint fresh
  // block ids on every reparse, so an incoming array shares nothing with what
  // is on screen and there is no reconciliation to do — the only question is
  // whether the reader has edits worth keeping, which is what the decision in
  // `documentState.ts` answers.
  useEffect(() => {
    documentKeyRef.current = resolvedDocumentKey;
    // Any queued focus intent names a block id from the outgoing document.
    // Those ids no longer exist, and a stale intent would fire the moment a
    // block with a colliding id registered.
    pendingFocusRef.current = null;

    const decision = decideDocumentBlocks(
      documentEntriesRef.current,
      resolvedDocumentKey,
      initialBlocks,
    );

    if (decision.action === "adopt") {
      recordDocumentBaseline(documentEntriesRef.current, resolvedDocumentKey, decision.blocks);
    }

    setBlocksState(decision.blocks);
  }, [resolvedDocumentKey, initialBlocks]);

  const state: EditorState = {
    blocks,
    paperId,
    loading,
    error,
  };

  // Debounced save to backend
  const saveToBackend = useCallback(async (_blocksToSave: Block[]) => {
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
        setError(err instanceof Error ? err.message : "Failed to save blocks");
      } finally {
        setLoading(false);
      }
    }, 1000);
  }, []);

  /**
   * The single write path for block mutations. Every mutator goes through it
   * so the per-document bookkeeping cannot be forgotten: one mutator writing
   * to state directly would leave its document looking untouched, and the next
   * document swap would silently throw the edit away.
   *
   * A write that changes nothing is dropped rather than recorded. TipTap emits
   * an update the moment it mounts and reconciles its own markup, so without
   * this a document would be dirty — and therefore unreplaceable — before the
   * reader had touched it.
   */
  const commit = useCallback(
    (mutate: (previous: Block[]) => Block[]) => {
      setBlocksState((previous) => {
        const updated = mutate(previous);
        if (updated === previous || blocksAreEquivalent(previous, updated)) {
          return previous;
        }

        recordDocumentEdit(documentEntriesRef.current, documentKeyRef.current, updated);
        void saveToBackend(updated);
        return updated;
      });
    },
    [saveToBackend],
  );

  const addBlock = useCallback(
    (type: Block["type"], index: number, content = ""): Block => {
      const newBlock: Block = {
        id: uuidv4(),
        type,
        content,
        metadata: type === "to_do_list" ? { checked: false } : undefined,
      };

      commit((prev) => {
        const updated = [...prev];
        updated.splice(index + 1, 0, newBlock);
        return updated;
      });

      return newBlock;
    },
    [commit],
  );

  const updateBlock = useCallback(
    (blockId: string, updates: Partial<Block>) => {
      commit((prev) =>
        prev.map((block) => (block.id === blockId ? { ...block, ...updates } : block)),
      );
    },
    [commit],
  );

  const deleteBlock = useCallback(
    (blockId: string) => {
      commit((prev) => prev.filter((block) => block.id !== blockId));
    },
    [commit],
  );

  const moveBlock = useCallback(
    (blockId: string, toIndex: number) => {
      commit((prev) => {
        const fromIndex = prev.findIndex((block) => block.id === blockId);
        if (fromIndex === -1) {
          return prev;
        }

        const updated = [...prev];
        const [movedBlock] = updated.splice(fromIndex, 1);
        updated.splice(toIndex, 0, movedBlock);
        return updated;
      });
    },
    [commit],
  );

  const insertBlock = useCallback(
    (block: Block, index: number) => {
      commit((prev) => {
        const updated = [...prev];
        updated.splice(index, 0, block);
        return updated;
      });
    },
    [commit],
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
      commit((prev) =>
        prev.map((block) => {
          if (block.id === blockId) {
            // Preserve metadata for to-do lists
            const metadata =
              newType === "to_do_list" ? { ...block.metadata, checked: false } : undefined;

            const content = block.content || "";

            return { ...block, type: newType, content, metadata };
          }
          return block;
        }),
      );
    },
    [commit],
  );

  const setBlocks = useCallback(
    (newBlocks: Block[]) => {
      commit(() => newBlocks);
    },
    [commit],
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
    setLocalAgent,
    getLocalAgent,
  };

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>;
}
