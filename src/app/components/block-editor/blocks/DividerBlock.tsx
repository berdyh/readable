"use client";

/**
 * Section rule inside the reading surface. It used to print the literal word
 * "Divider" between two rules — a debug label that shipped into the paper view.
 */
export function DividerBlock() {
  return <hr className="my-6 border-t border-zinc-200 dark:border-zinc-800" />;
}
