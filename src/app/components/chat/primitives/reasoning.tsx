"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

/**
 * Collapsible model-reasoning disclosure. Collapsed by default: reasoning is
 * secondary to the answer and should not compete with it for attention.
 */
export function Reasoning({
  content,
  defaultVisible = false,
}: {
  content?: string;
  defaultVisible?: boolean;
}) {
  const [isVisible, setIsVisible] = useState(defaultVisible);

  if (!content) return null;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setIsVisible((visible) => !visible)}
        aria-expanded={isVisible}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        {isVisible ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {isVisible ? "Hide reasoning" : "Show reasoning"}
      </button>

      {isVisible && (
        <div className="mt-1.5 whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300">
          {content}
        </div>
      )}
    </div>
  );
}
