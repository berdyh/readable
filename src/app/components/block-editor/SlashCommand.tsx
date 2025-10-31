"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useState,
} from "react";
import Suggestion, {
  type SuggestionKeyDownProps,
  type SuggestionProps,
} from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import tippy, { type Instance, type Props as TippyProps } from "tippy.js";
import { clsx } from "clsx";
import {
  CircleDashed,
  FileText,
  Globe,
  Image,
  Layers,
  Quote,
  Sparkles,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

import type { SlashCommandItem } from "./commands";

const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Layers,
  Image,
  Quote,
  FileText,
  Globe,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code,
  MessageSquare,
  CircleDashed,
};

interface SlashCommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

export interface SlashCommandListHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
}

const SlashCommandList = forwardRef<
  SlashCommandListHandle,
  SlashCommandListProps
>(({ items, command }, ref) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const selectedIndex = Math.min(
    activeIndex,
    Math.max(items.length - 1, 0),
  );

  const selectItem = useCallback(
    (index: number) => {
      const item = items[index];
      if (item) {
        command(item);
      }
    },
    [command, items],
  );

  useImperativeHandle(
    ref,
    () => ({
      onKeyDown: ({ event }) => {
        if (event.key === "ArrowUp") {
          event.preventDefault();
          setActiveIndex((prev) =>
            prev === 0 ? Math.max(items.length - 1, 0) : prev - 1,
          );
          return true;
        }

        if (event.key === "ArrowDown") {
          event.preventDefault();
          setActiveIndex((prev) =>
            prev >= items.length - 1 ? 0 : prev + 1,
          );
          return true;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }),
    [items.length, selectItem, selectedIndex],
  );

  if (!items.length) {
    return (
      <div className="min-w-[240px] rounded-lg border border-neutral-200 bg-white p-3 text-sm text-neutral-500 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
        No matches. Try searching for commands.
      </div>
    );
  }

  // Group items by category
  const groupedItems = items.reduce(
    (acc, item) => {
      const category = item.category || "text";
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    },
    {} as Record<string, SlashCommandItem[]>,
  );

  return (
    <div className="min-w-[280px] max-w-[320px] rounded-xl border border-neutral-200 bg-white p-2 shadow-xl ring-1 ring-neutral-950/5 dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/10 backdrop-blur-sm">
      <ul className="flex flex-col gap-1">
        {Object.entries(groupedItems).map(([category, categoryItems]) => (
          <li key={category}>
            {Object.keys(groupedItems).length > 1 && (
              <div className="px-2 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
                {category}
              </div>
            )}
            {categoryItems.map((item) => {
              const Icon = ICONS[item.icon] ?? CircleDashed;
              const globalIndex = items.indexOf(item);

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveIndex(globalIndex);
                    selectItem(globalIndex);
                  }}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-all duration-150",
                    selectedIndex === globalIndex
                      ? "bg-blue-100 text-blue-700 shadow-sm dark:bg-blue-500/20 dark:text-blue-200 dark:shadow-blue-500/10"
                      : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800 active:scale-[0.98]",
                  )}
                >
                  <span className={clsx(
                    "flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150",
                    selectedIndex === globalIndex
                      ? "bg-blue-200 text-blue-700 dark:bg-blue-500/30 dark:text-blue-200"
                      : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
                  )}>
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="font-medium">{item.title}</span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      {item.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </li>
        ))}
      </ul>
    </div>
  );
});

SlashCommandList.displayName = "SlashCommandList";

export interface SlashCommandOptions {
  items?: SlashCommandItem[];
  getItems?: () => SlashCommandItem[];
}

export const SlashCommandExtension = Extension.create<SlashCommandOptions>({
  name: "slash-command",

  addOptions() {
    return {
      items: [],
      getItems: undefined,
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: false, // Allow "/" anywhere in the block
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const parentNode = $from.parent;
          // Allow in paragraphs (which all our blocks use as base)
          return parentNode.type.name === "paragraph";
        },
        items: ({ query }) => {
          const needle = query.toLowerCase();
          const available =
            this.options.getItems?.() ?? this.options.items ?? [];
          return available
            .filter(
              (item) =>
                item.title.toLowerCase().includes(needle) ||
                item.id.toLowerCase().startsWith(needle) ||
                (item.keywords?.some((kw) =>
                  kw.toLowerCase().includes(needle),
                ) ?? false),
            )
            .slice(0, 10);
        },
        render: () => {
          let component:
            | ReactRenderer<SlashCommandListHandle, SlashCommandListProps>
            | null = null;
          let popup: Instance<TippyProps>[] = [];

          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              component = new ReactRenderer(SlashCommandList, {
                editor: this.editor,
                props: {
                  items: props.items,
                  command: (item: SlashCommandItem) => {
                    // TipTap Suggestion plugin's command expects the item directly
                    // It will pass it to our command callback as props
                    props.command(item);
                  },
                },
              });

              popup = tippy("body", {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
                arrow: false,
                theme: "light",
                // Disable default click outside behavior to avoid className.split errors
                hideOnClick: false,
              });

              popup[0]?.show();
            },
            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              component?.updateProps({
                items: props.items,
                command: (item: SlashCommandItem) => {
                  // TipTap Suggestion plugin's command expects the item directly
                  props.command(item);
                },
              });

              popup[0]?.setProps({
                getReferenceClientRect: props.clientRect as () => DOMRect,
              });
            },
            onKeyDown: (props) => {
              if (props.event.key === "Escape") {
                popup[0]?.hide();
                return true;
              }

              return component?.ref?.onKeyDown(props) ?? false;
            },
            onExit: () => {
              popup[0]?.destroy();
              popup = [];
              component?.destroy();
              component = null;
            },
          };
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .run();

          // The item is passed directly via props (TipTap Suggestion plugin structure)
          // props contains the selected item
          const item = props as unknown as SlashCommandItem;
          if (item && typeof item.run === 'function') {
            // The run function from buildSlashCommandItems is already bound to context
            // It's a closure that takes no parameters: () => cmd.run(context)
            // TypeScript may see the original type, but at runtime it's a no-arg function
            (item.run as () => void)();
          } else {
            console.error('SlashCommand: item.run is not a function', { item, props });
          }
        },
      }),
    ];
  },
});

