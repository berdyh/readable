"use client";

import { clsx } from "clsx";
import { Bot, User } from "lucide-react";

import type { ChatRole } from "../model/types";

interface MessageProps extends React.HTMLAttributes<HTMLDivElement> {
  from: ChatRole;
  children: React.ReactNode;
}

/** One row in a transcript: avatar plus body, mirrored for the user. */
export function Message({ from, children, className, ...props }: MessageProps) {
  return (
    <div
      className={clsx("flex gap-3", from === "user" ? "flex-row-reverse" : "flex-row", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function MessageAvatar({ from }: { from: ChatRole }) {
  const AvatarIcon = from === "user" ? User : Bot;

  return (
    <div
      className={clsx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
        from === "user"
          ? "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-zinc-950"
          : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
      )}
      aria-hidden="true"
    >
      <AvatarIcon className="h-4 w-4" />
    </div>
  );
}
