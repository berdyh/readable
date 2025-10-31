"use client";

import { forwardRef, useEffect, useRef } from "react";
import { clsx } from "clsx";

interface ConversationProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export const Conversation = forwardRef<HTMLDivElement, ConversationProps>(
  ({ className, children, ...props }, ref) => {
    return (
      <div
        ref={ref}
        className={clsx("relative flex flex-col overflow-hidden", className)}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Conversation.displayName = "Conversation";

export function ConversationContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Auto-scroll to bottom when new messages are added
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [children]);

  return (
    <div
      ref={scrollRef}
      className={clsx(
        "flex-1 overflow-y-auto px-4 py-4 space-y-4",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function ConversationScrollButton({
  onClick,
  className,
}: {
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "absolute bottom-4 right-4 z-10 rounded-full p-2 shadow-lg transition-opacity",
        "bg-neutral-100 text-neutral-900 hover:bg-neutral-200",
        "dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
        className,
      )}
      aria-label="Scroll to bottom"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m7 13 5 5 5-5" />
        <path d="m7 6 5 5 5-5" />
      </svg>
    </button>
  );
}


