"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ComponentType,
} from "react";
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
  FileText,
  Flame,
  Globe,
  Image,
  Layers,
  Loader2,
  MessageSquare,
  MoonStar,
  Quote,
  Sparkles,
  SunMedium,
} from "lucide-react";
import { useTheme } from "next-themes";

import { SlashCommandExtension } from "./SlashCommand";
import { buildSlashCommandItems, type SlashCommandItem } from "./commands";
import { useResearchCommands } from "./useResearchCommands";
import SummaryPanel, {
  type SummaryNote,
} from "../summary/SummaryPanel";

interface ResearchEditorProps {
  paperId: string;
  summaryHeading?: string;
  summaryDescription?: string;
  summaryNotes?: SummaryNote[];
  onSummarySelection?: (payload: { text: string; section?: string }) => void;
  onOpenChat?: () => void;
  statusMessage?: string | null;
  onStatusClear?: () => void;
}

const INITIAL_CONTENT = `
<h1>Designing persona-aware reading experiences</h1>
<p>Use this canvas to capture insights that flow into summaries, deeper dives, or citations. Highlight any passage to reveal inline tools, or press / to insert blocks.</p>
<ul>
  <li><strong>Summaries</strong> – jot down narrative arcs, evidence anchors, and page references.</li>
  <li><strong>Q&amp;A</strong> – draft clarifying questions and expected citations.</li>
  <li><strong>Persona</strong> – capture tone adjustments or prior knowledge gaps.</li>
</ul>
<p>Type <code>/</code> to explore block insertions.</p>
`;

const CHARACTER_LIMIT = 8000;

export function ResearchEditor({
  paperId,
  summaryHeading = "Summary at a glance",
  summaryDescription,
  summaryNotes,
  onSummarySelection,
  onOpenChat,
  statusMessage,
  onStatusClear,
}: ResearchEditorProps) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [slashItems, setSlashItems] = useState<SlashCommandItem[]>([]);

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
        getItems: () => slashItems,
      }),
    ],
    editorProps: {
      attributes: {
        class: "focus:outline-none",
      },
    },
    content: INITIAL_CONTENT,
    immediatelyRender: false,
  });

  const commands = useResearchCommands({
    editor,
    paperId,
  });

  useEffect(() => {
    setSlashItems(buildSlashCommandItems(commands));
  }, [commands]);

  const {
    summarizeSelection,
    expandCallout,
    insertFigures,
    insertCitations,
    insertArxiv,
    insertPdf,
    status: commandStatus,
    error: commandError,
    isRunning: commandRunning,
    clearStatus: clearCommandStatus,
  } = commands;

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

  const actionButtons = useMemo(
    () =>
      [
        onOpenChat
          ? {
              label: "Open chat",
              icon: MessageSquare,
              onClick: onOpenChat,
            }
          : null,
        {
          label: "Insert arXiv",
          icon: Globe,
          onClick: () => {
            void insertArxiv();
          },
        },
        {
          label: "Insert PDF",
          icon: FileText,
          onClick: () => {
            void insertPdf();
          },
        },
      ].filter(Boolean) as Array<{
        label: string;
        icon: ComponentType<{ className?: string }>;
        onClick: () => void;
      }>,
    [insertArxiv, insertPdf, onOpenChat],
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
        <div className="flex flex-col gap-1">
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
          <div className="flex flex-col gap-2">
            {commandStatus ? (
              <div
                className={clsx(
                  "inline-flex items-center gap-3 rounded-md border px-3 py-1 text-[11px] font-medium",
                  isDarkMode
                    ? "border-purple-600/60 bg-purple-900/40 text-purple-100"
                    : "border-purple-200 bg-purple-50 text-purple-700",
                )}
              >
                <span className="uppercase tracking-wide">Notebook</span>
                <span className="line-clamp-2 max-w-[320px] text-left">
                  {commandStatus}
                </span>
                <button
                  type="button"
                  onClick={clearCommandStatus}
                  className={clsx(
                    "text-[10px] uppercase",
                    isDarkMode ? "text-purple-200" : "text-purple-600",
                  )}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {commandError ? (
              <div
                className={clsx(
                  "inline-flex items-center gap-3 rounded-md border px-3 py-1 text-[11px] font-medium",
                  isDarkMode
                    ? "border-red-600/50 bg-red-900/40 text-red-200"
                    : "border-red-200 bg-red-50 text-red-600",
                )}
              >
                <span className="uppercase tracking-wide">Error</span>
                <span className="line-clamp-2 max-w-[320px] text-left">
                  {commandError}
                </span>
                <button
                  type="button"
                  onClick={clearCommandStatus}
                  className={clsx(
                    "text-[10px] uppercase",
                    isDarkMode ? "text-red-200" : "text-red-600",
                  )}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {statusMessage ? (
              <div
                className={clsx(
                  "inline-flex items-center gap-3 rounded-md border px-3 py-1 text-[11px] font-medium",
                  isDarkMode
                    ? "border-blue-700/60 bg-blue-900/40 text-blue-200"
                    : "border-blue-200 bg-blue-50 text-blue-600",
                )}
              >
                <span className="uppercase tracking-wide">Update</span>
                <span className="line-clamp-2 max-w-[320px] text-left">
                  {statusMessage}
                </span>
                {onStatusClear ? (
                  <button
                    type="button"
                    onClick={onStatusClear}
                    className={clsx(
                      "text-[10px] uppercase",
                      isDarkMode ? "text-blue-300" : "text-blue-500",
                    )}
                  >
                    Dismiss
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {actionButtons.length ? (
            <div
              className={clsx(
                "hidden items-center gap-2 rounded-full border px-2 py-1 text-xs font-medium transition sm:flex",
                isDarkMode
                  ? "border-neutral-700 bg-neutral-900 text-neutral-200"
                  : "border-neutral-300 bg-white text-neutral-600",
              )}
            >
              {actionButtons.map(({ label, icon: Icon, onClick }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1.5 transition",
                    isDarkMode
                      ? "hover:bg-neutral-800"
                      : "hover:bg-neutral-100",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          ) : null}
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
        {actionButtons.length ? (
          <div
            className={clsx(
              "flex items-center gap-3 sm:hidden",
              isDarkMode ? "text-neutral-300" : "text-neutral-600",
            )}
          >
            {actionButtons.map(({ label, icon: Icon, onClick }) => (
              <button
                key={label}
                type="button"
                onClick={onClick}
                className={clsx(
                  "inline-flex flex-1 items-center justify-center gap-1 rounded-full border px-3 py-2 text-xs font-medium transition",
                  isDarkMode
                    ? "border-neutral-700 bg-neutral-900 hover:bg-neutral-800"
                    : "border-neutral-200 bg-white hover:bg-neutral-100",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {editor && (
          <BubbleMenu
            editor={editor}
            tippyOptions={{
              duration: 120,
              offset: [0, 12],
              placement: "top",
            }}
            className={clsx(
              "flex items-center gap-2 rounded-2xl border px-3 py-2 shadow-lg",
              isDarkMode
                ? "border-neutral-700 bg-neutral-900"
                : "border-neutral-200 bg-white",
            )}
          >
            {[
              {
                label: "Quick Summary",
                icon: Sparkles,
                onClick: () => void summarizeSelection(),
                requiresSelection: true,
              },
              {
                label: "Deeper Dive",
                icon: Layers,
                onClick: () => expandCallout(),
                requiresSelection: false,
              },
              {
                label: "Fetch Figures",
                icon: Image,
                onClick: () => void insertFigures(),
                requiresSelection: true,
              },
              {
                label: "Cite",
                icon: Quote,
                onClick: () => void insertCitations(),
                requiresSelection: true,
              },
            ].map(({ label, icon: Icon, onClick, requiresSelection }) => {
              const disabled =
                commandRunning || (requiresSelection && !trimmedSelection);
              return (
                <button
                  key={label}
                  type="button"
                  disabled={disabled}
                  onClick={onClick}
                  className={clsx(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition",
                    !disabled
                      ? isDarkMode
                        ? "bg-neutral-800 text-neutral-50 hover:bg-neutral-700"
                        : "bg-neutral-100 text-neutral-800 hover:bg-neutral-200"
                      : "cursor-not-allowed opacity-40",
                  )}
                >
                  {commandRunning ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Icon className="h-3 w-3" />
                  )}
                  {label}
                </button>
              );
            })}
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

        {summaryNotes?.length ? (
          <div
            className={clsx(
              "rounded-2xl border px-4 py-4",
              isDarkMode
                ? "border-neutral-800 bg-neutral-950/30"
                : "border-neutral-200 bg-white/70",
            )}
          >
            <SummaryPanel
              heading={summaryHeading}
              description={summaryDescription}
              notes={summaryNotes}
              onSelection={onSummarySelection}
            />
          </div>
        ) : null}

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
