"use client";

import { forwardRef, useState, useRef, useEffect } from "react";
import { clsx } from "clsx";
import { Send, Paperclip, Globe } from "lucide-react";

interface PromptInputProps extends Omit<React.HTMLAttributes<HTMLFormElement>, "onSubmit"> {
  onSubmit: (value: string) => void;
  className?: string;
  autoSubmit?: boolean;
}

export const PromptInput = forwardRef<HTMLFormElement, PromptInputProps>(
  ({ onSubmit, className, children, autoSubmit = false, ...props }, ref) => {
    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const formData = new FormData(e.currentTarget);
      const value = formData.get("prompt") as string;
      if (value?.trim()) {
        onSubmit(value.trim());
      }
    };

    return (
      <form
        ref={ref}
        onSubmit={handleSubmit}
        className={clsx("flex flex-col gap-2 border-t p-4", className)}
        {...props}
      >
        {children}
      </form>
    );
  },
);
PromptInput.displayName = "PromptInput";

interface PromptInputTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  onMentionTrigger?: (query: string) => void;
}

export function PromptInputTextarea({
  value,
  onChange,
  onMentionTrigger,
  className,
  ...props
}: PromptInputTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const adjustHeight = () => {
      textarea.style.height = "auto";
      const scrollHeight = textarea.scrollHeight;
      const maxHeight = 200; // maxHeight in pixels
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    };

    // Adjust height on mount and when value changes
    adjustHeight();

    // Adjust height on input
    const handleInput = (e: Event) => {
      adjustHeight();
      const target = e.target as HTMLTextAreaElement;
      const cursorPos = target.selectionStart;
      const textBeforeCursor = target.value.substring(0, cursorPos);
      const lastAt = textBeforeCursor.lastIndexOf("@");

      if (lastAt !== -1) {
        const textAfterAt = textBeforeCursor.substring(lastAt + 1);
        // Check if there's a space or newline after @ (mention ended)
        if (textAfterAt.match(/[\s\n]/)) {
          setMentionQuery(null);
          onMentionTrigger?.("");
        } else {
          setMentionQuery(textAfterAt);
          onMentionTrigger?.(textAfterAt);
        }
      } else {
        setMentionQuery(null);
        onMentionTrigger?.("");
      }
    };

    textarea.addEventListener("input", handleInput);
    return () => textarea.removeEventListener("input", handleInput);
  }, [value, onMentionTrigger]);

  return (
    <textarea
      ref={textareaRef}
      name="prompt"
      value={value}
      onChange={onChange}
      rows={1}
      className={clsx(
        "w-full resize-none rounded-lg border px-4 py-3 text-sm outline-none transition-all overflow-y-auto",
        "border-neutral-200 bg-white text-neutral-900",
        "placeholder:text-neutral-500",
        "focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20",
        "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100",
        "dark:placeholder:text-neutral-400",
        "dark:focus:border-blue-400 dark:focus:ring-blue-400/20",
        className,
      )}
      style={{
        maxHeight: "200px",
        minHeight: "44px",
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const form = e.currentTarget.form;
          if (form) {
            form.requestSubmit();
          }
        }
      }}
      {...props}
    />
  );
}

export function PromptInputToolbar({
  children,
  className,
  showAttach = true,
  showSources = true,
  autoSubmit = false,
  onAutoSubmitToggle,
  showAllSources = true,
  onShowAllSourcesToggle,
}: {
  children?: React.ReactNode;
  className?: string;
  showAttach?: boolean;
  showSources?: boolean;
  autoSubmit?: boolean;
  onAutoSubmitToggle?: (enabled: boolean) => void;
  showAllSources?: boolean;
  onShowAllSourcesToggle?: (enabled: boolean) => void;
}) {
  return (
    <div
      className={clsx(
        "flex items-center justify-between gap-2 text-xs",
        "text-neutral-500 dark:text-neutral-400",
        className,
      )}
    >
      <div className="flex items-center gap-4">
        {showAttach && (
          <button
            type="button"
            className="hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors"
            aria-label="Attach file"
          >
            <Paperclip className="h-4 w-4" />
          </button>
        )}
        {onAutoSubmitToggle && (
          <button
            type="button"
            onClick={() => onAutoSubmitToggle(!autoSubmit)}
            className={clsx(
              "transition-colors",
              autoSubmit
                ? "text-blue-600 dark:text-blue-400 font-medium"
                : "hover:text-neutral-700 dark:hover:text-neutral-200",
            )}
          >
            Auto
          </button>
        )}
        {showSources && onShowAllSourcesToggle && (
          <button
            type="button"
            onClick={() => onShowAllSourcesToggle(!showAllSources)}
            className={clsx(
              "flex items-center gap-1 transition-colors",
              showAllSources
                ? "text-blue-600 dark:text-blue-400 font-medium"
                : "hover:text-neutral-700 dark:hover:text-neutral-200",
            )}
          >
            <Globe className="h-3 w-3" />
            <span>All sources</span>
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

export function PromptInputSubmit({
  disabled,
  className,
}: {
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className={clsx(
        "flex h-8 w-8 items-center justify-center rounded-full transition-colors",
        "bg-blue-600 text-white hover:bg-blue-700",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "dark:bg-blue-500 dark:hover:bg-blue-600",
        className,
      )}
      aria-label="Send message"
    >
      <Send className="h-4 w-4" />
    </button>
  );
}

