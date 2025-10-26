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
import { Flame, MoonStar, SunMedium } from "lucide-react";

import { EditorToolbar } from "./EditorToolbar";
import { SlashCommandExtension } from "./SlashCommand";
import { SLASH_COMMAND_ITEMS } from "./commands";

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
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (event: MediaQueryListEvent) => {
      setIsDarkMode(event.matches);
    };

    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setIsDarkMode((prev) => !prev);
  }, []);

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
    if (!editor) {
      return;
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) {
        return;
      }

      const insert = `AI summary placeholder for: "${detail.text.slice(0, 120)}"`;
      editor
        .chain()
        .focus()
        .insertContent(insert)
        .run();
    };

    window.addEventListener("editor-ai-action", handler);
    return () => window.removeEventListener("editor-ai-action", handler);
  }, [editor]);

  const characterCount = editor?.storage.characterCount.characters() ?? 0;

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
