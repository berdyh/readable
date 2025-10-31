"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Brain } from "lucide-react";

export function ReasoningTrigger({
  onClick,
  isVisible,
}: {
  onClick: () => void;
  isVisible: boolean;
}) {
  if (!isVisible) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
        "border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100",
        "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700",
      )}
    >
      <Brain className="h-3 w-3" />
      <span>Show reasoning</span>
    </button>
  );
}

export function ReasoningContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "rounded-lg border px-4 py-3 text-sm",
        "border-neutral-200 bg-neutral-50 text-neutral-700",
        "dark:border-neutral-700 dark:bg-neutral-900/50 dark:text-neutral-300",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-2 font-semibold">
        <Brain className="h-4 w-4" />
        <span>Reasoning</span>
      </div>
      <div className="whitespace-pre-wrap">{content}</div>
    </div>
  );
}

export function Reasoning({
  content,
  defaultVisible = false,
}: {
  content?: string;
  defaultVisible?: boolean;
}) {
  const [isVisible, setIsVisible] = useState(defaultVisible);

  if (!content) return null;

  if (isVisible) {
    return <ReasoningContent content={content} />;
  }

  return <ReasoningTrigger onClick={() => setIsVisible(true)} isVisible={!!content} />;
}


