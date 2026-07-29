"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Adler's "How to read a paper" three-pass method, as a piece of UI
 * state. Soft-guided: the user is free to jump pass at any time. The
 * state persists per-paper in localStorage so re-opening a paper picks
 * up where the reader left off.
 */
export type ThreePass = "skim" | "read" | "deep";

export const THREE_PASS_ORDER: ThreePass[] = ["skim", "read", "deep"];

export interface PassDescriptor {
  id: ThreePass;
  label: string;
  goal: string;
  /** What to do in this pass — short bullets, terse imperative tense. */
  guidance: string[];
  /** Approximate duration the reader should budget for this pass. */
  budget: string;
}

export const PASS_DESCRIPTORS: Record<ThreePass, PassDescriptor> = {
  skim: {
    id: "skim",
    label: "Skim",
    goal: "Decide whether the paper is worth a deeper read.",
    guidance: [
      "Read the title, abstract, intro, and conclusion.",
      "Glance at section headings and figure captions.",
      "Skip the math, tables, and detailed methodology.",
      "After this pass, you should know: what problem? what claim? what evidence?",
    ],
    budget: "5–10 minutes",
  },
  read: {
    id: "read",
    label: "Read",
    goal: "Grasp the content but skip proofs and edge cases.",
    guidance: [
      "Read the body in detail; ignore proofs, derivations, formal lemmas.",
      "Mark unclear concepts so you can return to them.",
      "Trace the figures and tables — most papers' results live there.",
      "After this pass, you should be able to explain the paper to a peer.",
    ],
    budget: "30–60 minutes",
  },
  deep: {
    id: "deep",
    label: "Deep",
    goal: "Re-create the paper. Identify hidden assumptions.",
    guidance: [
      "Reconstruct the argument from scratch alongside the authors'.",
      "Question every assumption; spot what is unstated or undefended.",
      "Identify implicit references you should follow up on.",
      "After this pass, you should be able to challenge the paper.",
    ],
    budget: "Several hours",
  },
};

const STORAGE_PREFIX = "readable:pass:";

function storageKey(paperId: string | undefined): string | undefined {
  if (!paperId) return undefined;
  return `${STORAGE_PREFIX}${paperId}`;
}

function readPersistedPass(paperId: string | undefined): ThreePass {
  if (typeof window === "undefined") return "skim";
  const key = storageKey(paperId);
  if (!key) return "skim";
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === "skim" || raw === "read" || raw === "deep") {
      return raw;
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR shell, etc.).
    // Fall through to default.
  }
  return "skim";
}

export interface UsePassStateOptions {
  paperId?: string;
}

export interface UsePassStateResult {
  pass: ThreePass;
  setPass: (next: ThreePass) => void;
  advance: () => void;
  rewind: () => void;
  descriptor: PassDescriptor;
  isFirst: boolean;
  isLast: boolean;
}

export function usePassState(options: UsePassStateOptions = {}): UsePassStateResult {
  const { paperId } = options;
  // SSR-safe default. Hydration from localStorage happens in a
  // post-mount effect so the initial server + client render match.
  const [pass, setPassRaw] = useState<ThreePass>("skim");

  // Hydrate from localStorage once, post-mount. queueMicrotask defers
  // the setState off the synchronous-effect path so the React Compiler
  // / Next 16 set-state-in-effect rule doesn't fire. Consumers that
  // care about the localStorage-flash race can render the bar inside a
  // section with `suppressHydrationWarning`.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const persisted = readPersistedPass(paperId);
      if (persisted !== "skim") {
        setPassRaw(persisted);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [paperId]);

  const setPass = useCallback(
    (next: ThreePass) => {
      setPassRaw(next);
      const key = storageKey(paperId);
      if (key && typeof window !== "undefined") {
        try {
          window.localStorage.setItem(key, next);
        } catch {
          // Storage quota / disabled — UX is unaffected, just no persistence.
        }
      }
    },
    [paperId],
  );

  const advance = useCallback(() => {
    const idx = THREE_PASS_ORDER.indexOf(pass);
    if (idx < THREE_PASS_ORDER.length - 1) {
      setPass(THREE_PASS_ORDER[idx + 1]);
    }
  }, [pass, setPass]);

  const rewind = useCallback(() => {
    const idx = THREE_PASS_ORDER.indexOf(pass);
    if (idx > 0) {
      setPass(THREE_PASS_ORDER[idx - 1]);
    }
  }, [pass, setPass]);

  return {
    pass,
    setPass,
    advance,
    rewind,
    descriptor: PASS_DESCRIPTORS[pass],
    isFirst: pass === THREE_PASS_ORDER[0],
    isLast: pass === THREE_PASS_ORDER[THREE_PASS_ORDER.length - 1],
  };
}
