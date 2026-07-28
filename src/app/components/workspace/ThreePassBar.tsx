"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import {
  PASS_DESCRIPTORS,
  THREE_PASS_ORDER,
  type ThreePass,
} from "./usePassState";

export interface ThreePassBarProps {
  pass: ThreePass;
  onPassChange: (next: ThreePass) => void;
}

/**
 * Theme styling is via Tailwind `dark:` utilities so server + client
 * render the same className string and never trigger a hydration
 * mismatch. The dark variant is activated by the `class="dark"` next-
 * themes adds to `<html>` before React hydrates.
 */
export function ThreePassBar({ pass, onPassChange }: ThreePassBarProps) {
  const [expanded, setExpanded] = useState(true);
  const descriptor = PASS_DESCRIPTORS[pass];

  const stripeBase =
    "border-neutral-200 bg-white text-neutral-800 " +
    "dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-200";

  const buttonInactive =
    "border border-neutral-300 text-neutral-500 hover:bg-neutral-100 " +
    "dark:border-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800";

  const buttonActive =
    "bg-neutral-900 text-white shadow " +
    "dark:bg-neutral-100 dark:text-neutral-900";

  const cardBase =
    "border-neutral-200 bg-neutral-50 text-neutral-600 " +
    "dark:border-neutral-800 dark:bg-neutral-900/60 dark:text-neutral-300";

  const toggleBase =
    "text-neutral-500 hover:bg-neutral-100 " +
    "dark:text-neutral-400 dark:hover:bg-neutral-800";

  // The active pill inverts its own foreground, so the step bubble has to
  // invert back or the number paints on top of its own colour and vanishes.
  const numberBubbleActive =
    "bg-white/25 text-white " +
    "dark:bg-neutral-900/20 dark:text-neutral-900";

  return (
    <section
      data-testid="three-pass-bar"
      aria-label="Three-pass reading method"
      // The pass state hydrates from localStorage post-mount so the
      // server-rendered "skim" default and the client's persisted
      // value can briefly differ — silence the warning, the next
      // render reconciles it.
      suppressHydrationWarning
      className={`mb-4 rounded-xl border ${stripeBase}`}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2">
          {THREE_PASS_ORDER.map((step, idx) => {
            const active = step === pass;
            return (
              <button
                key={step}
                type="button"
                onClick={() => onPassChange(step)}
                className={`inline-flex h-8 items-center rounded-full px-3 text-xs font-medium uppercase tracking-wide transition ${
                  active ? buttonActive : buttonInactive
                }`}
                aria-pressed={active}
                aria-label={`${PASS_DESCRIPTORS[step].label} pass`}
              >
                <span
                  className={`mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold ${
                    active
                      ? numberBubbleActive
                      : "border border-current"
                  }`}
                >
                  {idx + 1}
                </span>
                {PASS_DESCRIPTORS[step].label}
              </button>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="three-pass-guidance"
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${toggleBase}`}
          title={expanded ? "Hide guidance" : "Show guidance"}
        >
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </header>

      {expanded && (
        <div
          id="three-pass-guidance"
          className={`mx-4 mb-3 rounded-lg border px-4 py-3 ${cardBase}`}
        >
          <p className="mb-2 text-sm font-medium">
            {descriptor.label} pass · <span className="font-normal italic">{descriptor.goal}</span>
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            {descriptor.guidance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] uppercase tracking-wide opacity-70">
            Budget: {descriptor.budget}
          </p>
        </div>
      )}
    </section>
  );
}
