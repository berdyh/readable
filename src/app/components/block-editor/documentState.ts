import type { Block } from "./types";

/**
 * Per-source-document block state for the editor.
 *
 * The reading surface swaps whole documents underneath one editor instance:
 * the skim pass renders the summary artifact, read/deep render the paper HTML,
 * and both are re-parsed into blocks with freshly minted ids every time the
 * source flips. Because no id survives the swap, nothing can be reconciled —
 * whichever array arrives last simply wins, and a reader's edits vanish.
 *
 * The fix is to remember each source document separately, keyed by where its
 * blocks came from, and to refuse to overwrite a document the reader has
 * actually touched. Kept pure and free of React so the decision — the part
 * that is easy to get subtly wrong — is testable in the fast node project,
 * the same split `blockNavigation.ts` uses.
 */

export interface DocumentEntry {
  blocks: Block[];
  /** True once a mutator has run against this document in this session. */
  dirty: boolean;
}

export type DocumentEntries = Map<string, DocumentEntry>;

function metadataMatches(a: Block["metadata"], b: Block["metadata"]): boolean {
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b ?? {});
  if (aKeys.length !== bKeys.length) {
    return false;
  }

  return aKeys.every((key) => a?.[key] === b?.[key]);
}

/**
 * Whether two block arrays say the same thing.
 *
 * Needed because a write is not automatically an edit: TipTap emits an update
 * as soon as it mounts and reconciles its own markup, so an untouched document
 * would otherwise mark itself dirty just by being rendered — and a dirty
 * document refuses to be replaced. Identity is no help here, since every write
 * builds a new array.
 */
export function blocksAreEquivalent(a: Block[], b: Block[]): boolean {
  if (a === b) {
    return true;
  }

  if (a.length !== b.length) {
    return false;
  }

  return a.every((block, index) => {
    const other = b[index];
    return (
      block.id === other.id &&
      block.type === other.type &&
      block.content === other.content &&
      metadataMatches(block.metadata, other.metadata)
    );
  });
}

export type DocumentDecision =
  /** No local edits for this key: take the incoming blocks as the new baseline. */
  | { action: "adopt"; blocks: Block[] }
  /** This key has edits: hand back what the reader left behind. */
  | { action: "restore"; blocks: Block[] };

/**
 * Decide what the editor should show for `documentKey` when `initialBlocks`
 * arrives. A key with no entry is a document this session has never shown, so
 * it always adopts; a clean entry adopts too, which is what lets real content
 * replace a placeholder and lets a refreshed summary land.
 */
export function decideDocumentBlocks(
  entries: ReadonlyMap<string, DocumentEntry>,
  documentKey: string,
  initialBlocks: Block[],
): DocumentDecision {
  const entry = entries.get(documentKey);

  if (entry?.dirty) {
    return { action: "restore", blocks: entry.blocks };
  }

  return { action: "adopt", blocks: initialBlocks };
}

/** Record incoming blocks as the untouched baseline for `documentKey`. */
export function recordDocumentBaseline(
  entries: DocumentEntries,
  documentKey: string,
  blocks: Block[],
): void {
  entries.set(documentKey, { blocks, dirty: false });
}

/**
 * Record the result of a mutation. Every editor mutator funnels through this,
 * so a document is dirty from its first edit until the editor unmounts.
 */
export function recordDocumentEdit(
  entries: DocumentEntries,
  documentKey: string,
  blocks: Block[],
): void {
  entries.set(documentKey, { blocks, dirty: true });
}
