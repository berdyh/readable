"use client";

/**
 * Chat → editor seam. The mirror of `intents.ts` (editor → chat): the chat
 * surface asks the editor to reveal the block behind a citation, and the editor
 * answers whether it could. Like `intents.ts` this is a DOM CustomEvent
 * contract, not props or context, because the two trees are siblings.
 *
 * Owned by the editor: the editor defines what a navigable target is, so the
 * event names and payload shapes live here and chat imports them.
 */

export const BLOCK_NAVIGATE_EVENT = "block-editor-navigate";
export const BLOCK_NAVIGATE_RESULT_EVENT = "block-editor-navigate-result";

export type BlockNavigateStatus = "success" | "unavailable";
export type BlockNavigateFailureReason = "target-not-found" | "element-not-found";

export interface BlockNavigateDetail {
  /** Correlates a request with its result; omit only for fire-and-forget. */
  requestId?: string;
  paperId: string;
  chunkId?: string;
  page?: number;
  quote?: string;
}

export interface BlockNavigateResultDetail {
  requestId: string;
  status: BlockNavigateStatus;
  reason?: BlockNavigateFailureReason;
}

function createRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `source-nav-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Ask the editor to reveal a citation target. Returns the request id to await. */
export function emitBlockNavigate(detail: Omit<BlockNavigateDetail, "requestId">): string {
  const requestId = createRequestId();
  window.dispatchEvent(
    new CustomEvent<BlockNavigateDetail>(BLOCK_NAVIGATE_EVENT, {
      detail: { ...detail, requestId },
    }),
  );
  return requestId;
}

/**
 * Listen for the result of one navigate request. Returns an unsubscribe fn;
 * the listener also removes itself once its request has been answered.
 */
export function onBlockNavigateResult(
  requestId: string,
  onResult: (status: BlockNavigateStatus, reason?: BlockNavigateFailureReason) => void,
): () => void {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<BlockNavigateResultDetail>).detail;
    if (!detail || detail.requestId !== requestId) {
      return;
    }

    window.removeEventListener(BLOCK_NAVIGATE_RESULT_EVENT, handler);
    onResult(detail.status, detail.reason);
  };

  window.addEventListener(BLOCK_NAVIGATE_RESULT_EVENT, handler);
  return () => window.removeEventListener(BLOCK_NAVIGATE_RESULT_EVENT, handler);
}

export function emitBlockNavigateResult(detail: BlockNavigateResultDetail): void {
  window.dispatchEvent(
    new CustomEvent<BlockNavigateResultDetail>(BLOCK_NAVIGATE_RESULT_EVENT, { detail }),
  );
}
