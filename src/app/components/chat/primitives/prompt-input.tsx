"use client";

import { useEffect, useRef } from "react";
import { clsx } from "clsx";

const MAX_TEXTAREA_HEIGHT = 200;

/**
 * Auto-growing composer textarea. Grows with content up to
 * `MAX_TEXTAREA_HEIGHT` and then scrolls, so a long draft never pushes the
 * send button off screen.
 */
export function PromptInputTextarea({
  value,
  onChange,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [value]);

  return (
    <textarea
      ref={textareaRef}
      name="prompt"
      value={value}
      onChange={onChange}
      rows={1}
      className={clsx(
        "w-full resize-none overflow-y-auto rounded-lg border px-3 py-2 text-sm leading-relaxed outline-none",
        "transition-[border-color,box-shadow] duration-150",
        "border-zinc-200 bg-white text-zinc-900 placeholder:text-zinc-500",
        "focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20",
        "dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-400",
        "dark:focus:border-emerald-400 dark:focus:ring-emerald-400/20",
        className,
      )}
      style={{ maxHeight: `${MAX_TEXTAREA_HEIGHT}px` }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }}
      {...props}
    />
  );
}
