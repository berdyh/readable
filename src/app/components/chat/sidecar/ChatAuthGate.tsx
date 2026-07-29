"use client";

import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { MessageSquare, Sparkles, X } from "lucide-react";

/** Signed-out state for the sidecar. Says what signing in unlocks, then acts. */
export function ChatAuthGate({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          <h2 className="text-sm font-semibold">Research chat</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="touch-target relative inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          aria-label="Close chat"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </header>

      <div className="flex flex-1 items-center justify-center px-6">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base font-semibold">Sign in to chat</h3>
            <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              Saved chats, sources, and reading preferences are tied to your account.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <SignInButton>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md bg-zinc-950 px-4 text-sm font-medium text-white transition-colors duration-150 hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button
                type="button"
                className="inline-flex h-9 items-center rounded-md border border-zinc-300 px-4 text-sm font-medium text-zinc-800 transition-colors duration-150 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
              >
                Sign up
              </button>
            </SignUpButton>
          </div>
        </div>
      </div>
    </div>
  );
}
