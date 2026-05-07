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
  isDarkMode: boolean;
}

export function ThreePassBar({
  pass,
  onPassChange,
  isDarkMode,
}: ThreePassBarProps) {
  const [expanded, setExpanded] = useState(true);
  const descriptor = PASS_DESCRIPTORS[pass];

  const stripeBase = isDarkMode
    ? "border-neutral-800 bg-neutral-900 text-neutral-200"
    : "border-neutral-200 bg-white text-neutral-800";

  const buttonBase = (active: boolean) =>
    `inline-flex h-8 items-center rounded-full px-3 text-xs font-medium uppercase tracking-wide transition ${
      active
        ? isDarkMode
          ? "bg-neutral-100 text-neutral-900 shadow"
          : "bg-neutral-900 text-white shadow"
        : isDarkMode
          ? "border border-neutral-700 text-neutral-400 hover:bg-neutral-800"
          : "border border-neutral-300 text-neutral-500 hover:bg-neutral-100"
    }`;

  const cardBase = isDarkMode
    ? "border-neutral-800 bg-neutral-900/60 text-neutral-300"
    : "border-neutral-200 bg-neutral-50 text-neutral-600";

  return (
    <section
      data-testid="three-pass-bar"
      aria-label="Three-pass reading method"
      className={`mb-4 rounded-xl border ${stripeBase}`}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-2">
        <div className="flex items-center gap-2">
          {THREE_PASS_ORDER.map((step, idx) => (
            <button
              key={step}
              type="button"
              onClick={() => onPassChange(step)}
              className={buttonBase(step === pass)}
              aria-pressed={step === pass}
              aria-label={`${PASS_DESCRIPTORS[step].label} pass`}
            >
              <span
                className="mr-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-semibold"
                style={{
                  background:
                    step === pass
                      ? "currentColor"
                      : "transparent",
                  color: step === pass ? (isDarkMode ? "#171717" : "#fff") : "currentColor",
                  border:
                    step === pass
                      ? "0"
                      : "1px solid currentColor",
                }}
              >
                {idx + 1}
              </span>
              {PASS_DESCRIPTORS[step].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="three-pass-guidance"
          className={`inline-flex h-8 w-8 items-center justify-center rounded-full transition ${
            isDarkMode
              ? "text-neutral-400 hover:bg-neutral-800"
              : "text-neutral-500 hover:bg-neutral-100"
          }`}
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
