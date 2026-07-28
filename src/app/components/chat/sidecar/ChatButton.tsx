"use client";

import { MessageSquare } from "lucide-react";

/** Floating launcher for the research chat sidecar. */
export function ChatButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-8 right-8 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-950 text-white shadow-lg transition-[transform,box-shadow,background-color] duration-150 hover:-translate-y-0.5 hover:bg-zinc-800 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:ring-offset-zinc-950"
      aria-label="Open research chat"
      title="Open research chat"
    >
      <MessageSquare className="h-6 w-6" aria-hidden="true" />
    </button>
  );
}
