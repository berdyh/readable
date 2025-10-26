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
import type { Editor } from "@tiptap/react";
import { ReactRenderer } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import tippy, { type Instance, type Props as TippyProps } from "tippy.js";
import { clsx } from "clsx";
import {
  CircleDashed,
  Code,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Minus,
  Quote,
  Type,
  type LucideIcon,
} from "lucide-react";

import type { SlashCommandItem } from "./commands";

const ICONS: Record<string, LucideIcon> = {
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Minus,
};

interface SlashCommandListProps {
  items: SlashCommandItem[];
  editor: Editor;
  range: { from: number; to: number };
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
        No matches. Try searching for “heading” or “list”.
      </div>
    );
  }

  return (
    <div className="min-w-[260px] max-w-[320px] rounded-xl border border-neutral-200 bg-white p-2 shadow-xl ring-1 ring-neutral-950/5 dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/10">
      <div className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">
        Insert block
      </div>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => {
          const Icon = ICONS[item.icon] ?? CircleDashed;

          return (
            <li key={item.title}>
              <button
                type="button"
                onClick={() => {
                  setActiveIndex(index);
                  selectItem(index);
                }}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition",
                  selectedIndex === index
                    ? "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800",
                )}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    {item.description}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
});

SlashCommandList.displayName = "SlashCommandList";

export interface SlashCommandOptions {
  items: SlashCommandItem[];
}

export const SlashCommandExtension = Extension.create<SlashCommandOptions>({
  name: "slash-command",

  addOptions() {
    return {
      items: [],
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        startOfLine: true,
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const parentNode = $from.parent;
          return parentNode.type.name === "paragraph";
        },
        items: ({ query }) => {
          return this.options.items
            .filter((item) =>
              item.title.toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 8);
        },
        render: () => {
          let component:
            | ReactRenderer<SlashCommandListHandle, SlashCommandListProps>
            | null = null;
          let popup: Instance<TippyProps>[] = [];

          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              component = new ReactRenderer(SlashCommandList, {
                editor: props.editor,
                props: {
                  items: props.items,
                  editor: props.editor,
                  range: props.range,
                  command: (item) => {
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
              });

              popup[0]?.show();
            },
            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              component?.updateProps({
                items: props.items,
                editor: props.editor,
                range: props.range,
                command: (item) => props.command(item),
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

          props.item.command(editor);
        },
      }),
    ];
  },
});
