"use client";

import { forwardRef, useEffect, useRef } from "react";
import { clsx } from "clsx";

/**
 * Scroll container for a message list. Layout only — callers own padding and
 * rhythm so the primitive never fights the surface embedding it.
 */
export const Conversation = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => (
    <div ref={ref} className={clsx("relative flex flex-col overflow-hidden", className)} {...props}>
      {children}
    </div>
  ),
);
Conversation.displayName = "Conversation";

export function ConversationContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [children]);

  return (
    <div ref={scrollRef} className={clsx("flex-1 overflow-y-auto", className)} {...props}>
      {children}
    </div>
  );
}
