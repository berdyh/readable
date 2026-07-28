"use client";

import { clsx } from "clsx";

import type { SlashCommandOption } from "../model/slashCommands";

/** Command palette that opens above the inline composer while typing `/`. */
export function SlashCommandMenu({
  options,
  activeIndex,
  onSelect,
  onHighlight,
}: {
  options: SlashCommandOption[];
  activeIndex: number;
  onSelect: (option: SlashCommandOption) => void;
  onHighlight?: (index: number) => void;
}) {
  if (options.length === 0) {
    return null;
  }

  return (
    <div
      role="listbox"
      aria-label="Slash commands"
      className="absolute bottom-full left-0 z-30 mb-2 w-full rounded-lg border border-zinc-200 bg-white p-1.5 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="flex flex-col gap-0.5">
        {options.map((option, index) => {
          const isActive = index === activeIndex;
          return (
            <button
              type="button"
              key={option.id}
              role="option"
              aria-selected={isActive}
              onClick={() => onSelect(option)}
              onMouseEnter={() => onHighlight?.(index)}
              className={clsx(
                "flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors duration-150",
                isActive
                  ? "bg-emerald-600 text-white"
                  : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800",
              )}
            >
              <span className="text-sm font-semibold">{option.label}</span>
              <span
                className={clsx(
                  "text-xs",
                  isActive ? "text-emerald-50" : "text-zinc-500 dark:text-zinc-400",
                )}
              >
                {option.description}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
