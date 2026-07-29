"use client";

import { useEffect } from "react";

import { resolveNavigationTarget } from "./blockNavigation";
import {
  BLOCK_NAVIGATE_EVENT,
  emitBlockNavigateResult,
  type BlockNavigateDetail,
  type BlockNavigateFailureReason,
  type BlockNavigateStatus,
} from "./navigation";
import type { Block } from "./types";

/** How long the "you are here" ring stays on the revealed block. */
const HIGHLIGHT_DURATION_MS = 2000;

/**
 * Emerald matches the source row that requested the jump, so the citation and
 * the paragraph it opened read as the same action.
 */
const HIGHLIGHT_CLASSES = [
  "ring-2",
  "ring-emerald-500",
  "dark:ring-emerald-400",
  "bg-emerald-50/60",
  "dark:bg-emerald-950/30",
];

function revealBlock(blockId: string): boolean {
  const element = document.querySelector(`[data-block-id="${blockId}"]`);
  if (!element) {
    return false;
  }

  element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

  if (element instanceof HTMLElement) {
    const previousTabIndex = element.getAttribute("tabindex");
    element.setAttribute("tabindex", "-1");
    element.focus({ preventScroll: true });

    window.setTimeout(() => {
      if (previousTabIndex === null) {
        element.removeAttribute("tabindex");
      } else {
        element.setAttribute("tabindex", previousTabIndex);
      }
    }, HIGHLIGHT_DURATION_MS);
  }

  element.classList.add(...HIGHLIGHT_CLASSES);
  window.setTimeout(() => element.classList.remove(...HIGHLIGHT_CLASSES), HIGHLIGHT_DURATION_MS);
  return true;
}

/**
 * Editor half of the chat → editor seam: answer `block-editor-navigate` by
 * scrolling the matching block into view and reporting back.
 */
export function useBlockNavigation(blocks: Block[], paperId: string) {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<BlockNavigateDetail>).detail;
      if (!detail || detail.paperId !== paperId) {
        return;
      }

      const target = resolveNavigationTarget(blocks, detail);
      const revealed = target ? revealBlock(target.id) : false;

      if (!detail.requestId) {
        return;
      }

      const result = {
        requestId: detail.requestId,
        status: (revealed ? "success" : "unavailable") as BlockNavigateStatus,
        reason: revealed
          ? undefined
          : ((target ? "element-not-found" : "target-not-found") as BlockNavigateFailureReason),
      };

      // Deferred, and that is load-bearing. emitBlockNavigate() dispatches
      // synchronously and only then returns the requestId, so the caller cannot
      // subscribe until after this handler has run:
      //
      //   const requestId = emitBlockNavigate(...);   // we reply during this call
      //   onBlockNavigateResult(requestId, ...);      // too late if we replied inline
      //
      // Replying inline meant every caller missed every result. sources.tsx
      // then hit its timeout and flipped a successfully revealed citation to
      // "unavailable" — the trust-first UI reporting failure on success.
      // A microtask lands after the caller's synchronous subscribe.
      queueMicrotask(() => emitBlockNavigateResult(result));
    };

    window.addEventListener(BLOCK_NAVIGATE_EVENT, handler);
    return () => window.removeEventListener(BLOCK_NAVIGATE_EVENT, handler);
  }, [blocks, paperId]);
}
