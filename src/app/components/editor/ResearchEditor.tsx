"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EditorContent, useEditor, BubbleMenu } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import HorizontalRule from "@tiptap/extension-horizontal-rule";
import CharacterCount from "@tiptap/extension-character-count";
import BubbleMenuExtension from "@tiptap/extension-bubble-menu";
import { clsx } from "clsx";
import {
  Flame,
  MessageSquare,
  MoonStar,
  Sparkles,
  SunMedium,
} from "lucide-react";
import { useTheme } from "next-themes";

import { EditorToolbar } from "./EditorToolbar";
import { SlashCommandExtension } from "./SlashCommand";
import { SLASH_COMMAND_ITEMS } from "./commands";
import {
  emitEditorIntent,
  type EditorIntentAction,
} from "./intents";

const INITIAL_CONTENT = `
<h1>Designing persona-aware reading experiences</h1>
<p>Use this canvas to capture insights that should flow into summaries, Q&amp;A prompts, or persona tailoring. The toolbar and slash menu expose the same primitives as our AI orchestration layer.</p>
<ul>
  <li><strong>Summaries</strong> – jot down narrative arcs, evidence anchors, and page references.</li>
  <li><strong>Q&amp;A</strong> – draft clarifying questions and expected citations.</li>
  <li><strong>Persona</strong> – capture tone adjustments or prior knowledge gaps.</li>
</ul>
<p>Type <code>/</code> to explore block insertions.</p>
`;

const CHARACTER_LIMIT = 8000;

export function ResearchEditor() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const slashCommandItems = useMemo(() => SLASH_COMMAND_ITEMS, []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        bulletList: {
          keepAttributes: false,
          keepMarks: true,
        },
        orderedList: {
          keepMarks: true,
        },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        linkOnPaste: true,
      }),
      Color.configure({ types: ["textStyle"] }),
      TextStyle,
      Highlight.configure({
        multicolor: true,
      }),
      HorizontalRule,
      Placeholder.configure({
        placeholder: "Press '/' for commands or start typing…",
      }),
      CharacterCount.configure({
        limit: CHARACTER_LIMIT,
      }),
      BubbleMenuExtension.configure({
        pluginKey: "bubbleMenu",
        shouldShow: ({ state }) => {
          const { from, to } = state.selection;
          return from !== to;
        },
      }),
      SlashCommandExtension.configure({
        items: slashCommandItems,
      }),
    ],
    editorProps: {
      attributes: {
        class: "focus:outline-none",
      },
    },
    content: INITIAL_CONTENT,
  });

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setMounted(true);
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  const characterCount = editor?.storage.characterCount.characters() ?? 0;
  const selectionText =
    editor?.state.doc.textBetween(
      editor.state.selection.from,
      editor.state.selection.to,
      " ",
    ) ?? "";
  const trimmedSelection = selectionText.trim();

  const sendIntent = useCallback(
    (action: EditorIntentAction, text: string, origin?: string) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      emitEditorIntent({
        action,
        text: normalized,
        origin: origin ?? "research-editor",
      });
    },
    [],
  );

  if (!mounted) {
    return null;
  }

  const isDarkMode = resolvedTheme === "dark";
  const toggleTheme = () => {
    setTheme(isDarkMode ? "light" : "dark");
  };

  const containerClasses = clsx(
    "relative rounded-3xl border shadow-sm ring-1 transition",
    isDarkMode
      ? "border-neutral-800 bg-neutral-950/60 text-neutral-100 ring-white/10"
      : "border-neutral-200 bg-white/70 text-neutral-900 ring-neutral-950/5",
  );

  return (
    <div className={containerClasses}>
      <div
        className={clsx(
          "flex items-center justify-between border-b px-5 py-3",
          isDarkMode ? "border-neutral-800" : "border-neutral-200",
        )}
      >
        <div className="flex flex-col">
          <span
            className={clsx(
              "text-sm font-semibold",
              isDarkMode ? "text-neutral-300" : "text-neutral-600",
            )}
          >
            Research notebook
          </span>
          <span
            className={clsx(
              "text-xs",
              isDarkMode ? "text-neutral-500" : "text-neutral-400",
            )}
          >
            Capture snippets before promoting to summary, Q&amp;A, or persona
            updates.
          </span>
        </div>
        <div className="flex items-center gap-3">
          <EditorToolbar
            editor={editor}
            theme={isDarkMode ? "dark" : "light"}
          />
          <button
            type="button"
            onClick={toggleTheme}
            className={clsx(
              "inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition",
              isDarkMode
                ? "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100",
            )}
            title="Toggle editor theme"
          >
            {isDarkMode ? (
              <SunMedium className="h-4 w-4" />
            ) : (
              <MoonStar className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="grid gap-2 px-5 pb-5 pt-4">
        {editor && (
          <BubbleMenu
            editor={editor}
            tippyOptions={{
              duration: 120,
              offset: [0, 12],
              placement: "top",
            }}
            className={clsx(
              "flex items-center gap-1 rounded-xl border px-2 py-1 shadow-lg",
              isDarkMode
                ? "border-neutral-700 bg-neutral-900"
                : "border-neutral-200 bg-white",
            )}
          >
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleBold().run()}
                className={clsx(
                  "h-7 w-7 rounded-md text-xs font-semibold transition",
                  editor.isActive("bold")
                    ? "bg-blue-600 text-white"
                    : isDarkMode
                    ? "text-neutral-200 hover:bg-neutral-800"
                    : "text-neutral-600 hover:bg-neutral-100",
                )}
              >
                B
              </button>
              <button
                type="button"
                onClick={() => editor.chain().focus().toggleItalic().run()}
                className={clsx(
                  "h-7 w-7 rounded-md text-xs font-semibold italic transition",
                  editor.isActive("italic")
                    ? "bg-blue-600 text-white"
                    : isDarkMode
                    ? "text-neutral-200 hover:bg-neutral-800"
                    : "text-neutral-600 hover:bg-neutral-100",
                )}
              >
                I
              </button>
              <button
                type="button"
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .toggleHighlight({ color: "#fde68a" })
                    .run()
                }
                className={clsx(
                  "h-7 w-7 rounded-md text-xs font-semibold transition",
                  editor.isActive("highlight", { color: "#fde68a" })
                    ? "bg-amber-400 text-neutral-900"
                    : isDarkMode
                    ? "text-neutral-200 hover:bg-neutral-800"
                    : "text-neutral-600 hover:bg-neutral-100",
                )}
              >
                ✦
              </button>
            </div>

            <span
              className={clsx(
                "mx-1 h-5 w-px",
                isDarkMode ? "bg-neutral-800" : "bg-neutral-200",
              )}
            />

            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled={!trimmedSelection}
                onClick={() =>
                  sendIntent("go-deeper", trimmedSelection, "research-editor")
                }
                title="Ask for deeper explanation"
                className={clsx(
                  "flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium transition",
                  trimmedSelection
                    ? isDarkMode
                      ? "bg-blue-500/20 text-blue-200 hover:bg-blue-500/30"
                      : "bg-blue-100 text-blue-700 hover:bg-blue-200"
                    : "cursor-not-allowed opacity-40",
                )}
              >
                <MessageSquare className="mr-1 h-3.5 w-3.5" />
                Deepen
              </button>
              <button
                type="button"
                disabled={!trimmedSelection}
                onClick={() =>
                  sendIntent("condense", trimmedSelection, "research-editor")
                }
                title="Summarize more concisely"
                className={clsx(
                  "flex h-7 items-center justify-center rounded-md px-2 text-xs font-medium transition",
                  trimmedSelection
                    ? isDarkMode
                      ? "bg-purple-500/20 text-purple-200 hover:bg-purple-500/30"
                      : "bg-purple-100 text-purple-700 hover:bg-purple-200"
                    : "cursor-not-allowed opacity-40",
                )}
              >
                <Sparkles className="mr-1 h-3.5 w-3.5" />
                Condense
              </button>
            </div>
          </BubbleMenu>
        )}

        <div
          className={clsx(
            "rounded-2xl border px-5 py-6",
            isDarkMode
              ? "border-neutral-800 bg-neutral-950/40"
              : "border-neutral-200 bg-white/60",
          )}
        >
          <EditorContent
            editor={editor}
            className={clsx(
              "prose max-w-none text-[15px] leading-relaxed",
              isDarkMode ? "prose-invert" : "prose-neutral",
            )}
          />
        </div>

        <div
          className={clsx(
            "flex items-center justify-between rounded-2xl border border-dashed px-4 py-3 text-xs",
            isDarkMode
              ? "border-neutral-700 text-neutral-400"
              : "border-neutral-200 text-neutral-500",
          )}
        >
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-400" />
            <span>
              {characterCount.toLocaleString()} / {CHARACTER_LIMIT.toLocaleString()}{" "}
              characters
            </span>
          </div>
          <span>Use “/persona” to annotate tone shifts (coming soon)</span>
        </div>
      </div>
    </div>
  );
}
