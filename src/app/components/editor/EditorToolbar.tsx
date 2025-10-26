"use client";

import { Fragment, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { clsx } from "clsx";
import {
  Bold,
  Code,
  Highlighter,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo,
  Sparkles,
  Strikethrough,
  Underline,
  Undo,
} from "lucide-react";

interface ToolbarButtonConfig {
  key: string;
  label: string;
  icon: ReactNode;
  isActive?: (editor: Editor) => boolean;
  onClick: (editor: Editor) => void;
}

const textButtons: ToolbarButtonConfig[] = [
  {
    key: "bold",
    label: "Bold",
    icon: <Bold className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("bold"),
    onClick: (editor) => editor.chain().focus().toggleBold().run(),
  },
  {
    key: "italic",
    label: "Italic",
    icon: <Italic className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("italic"),
    onClick: (editor) => editor.chain().focus().toggleItalic().run(),
  },
  {
    key: "underline",
    label: "Underline",
    icon: <Underline className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("underline"),
    onClick: (editor) => editor.chain().focus().toggleUnderline().run(),
  },
  {
    key: "strike",
    label: "Strike",
    icon: <Strikethrough className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("strike"),
    onClick: (editor) => editor.chain().focus().toggleStrike().run(),
  },
  {
    key: "code",
    label: "Code",
    icon: <Code className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("code"),
    onClick: (editor) => editor.chain().focus().toggleCode().run(),
  },
];

const structureButtons: ToolbarButtonConfig[] = [
  {
    key: "bullet",
    label: "Bullet list",
    icon: <List className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("bulletList"),
    onClick: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    key: "ordered",
    label: "Numbered list",
    icon: <ListOrdered className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("orderedList"),
    onClick: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    key: "blockquote",
    label: "Quote",
    icon: <Quote className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("blockquote"),
    onClick: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
];

const highlightButtons: ToolbarButtonConfig[] = [
  {
    key: "highlight",
    label: "Highlight",
    icon: <Highlighter className="h-4 w-4" />,
    isActive: (editor) => editor.isActive("highlight", { color: "#fde68a" }),
    onClick: (editor) =>
      editor.chain().focus().toggleHighlight({ color: "#fde68a" }).run(),
  },
  {
    key: "link",
    label: "Link",
    icon: <LinkIcon className="h-4 w-4" />,
    onClick: (editor) => {
      const previousUrl = editor.getAttributes("link").href;
      const url = window.prompt("Enter URL", previousUrl);
      if (url === null) {
        return;
      }

      if (url === "") {
        editor.chain().focus().extendMarkRange("link").unsetLink().run();
        return;
      }

      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    },
  },
];

export function EditorToolbar({
  editor,
  theme = "light",
}: {
  editor: Editor | null;
  theme?: "light" | "dark";
}) {
  if (!editor) {
    return null;
  }

  const isDark = theme === "dark";

  const groups: ToolbarButtonConfig[][] = [
    [
      {
        key: "undo",
        label: "Undo",
        icon: <Undo className="h-4 w-4" />,
        onClick: (ed) => ed.chain().focus().undo().run(),
      },
      {
        key: "redo",
        label: "Redo",
        icon: <Redo className="h-4 w-4" />,
        onClick: (ed) => ed.chain().focus().redo().run(),
      },
    ],
    textButtons,
    structureButtons,
    highlightButtons,
    [
      {
        key: "ai",
        label: "Summarise selection (⌘+Shift+I)",
        icon: <Sparkles className="h-4 w-4 text-purple-500" />,
        onClick: (ed) => {
          const text = ed.state.doc.textBetween(
            ed.state.selection.from,
            ed.state.selection.to,
            " ",
          );
          window.dispatchEvent(
            new CustomEvent("editor-ai-action", {
              detail: { text },
            }),
          );
        },
      },
    ],
  ];

  return (
    <div
      className={clsx(
        "flex flex-wrap items-center gap-2 rounded-xl border p-2 shadow-sm backdrop-blur",
        isDark
          ? "border-neutral-700 bg-neutral-900/80"
          : "border-neutral-200 bg-white/80",
      )}
    >
      {groups.map((group, index) => (
        <Fragment key={index}>
          <div className="flex items-center gap-1">
            {group.map((button) => (
              <button
                key={button.key}
                type="button"
                title={button.label}
                onClick={() => button.onClick(editor)}
                className={clsx(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60",
                  button.isActive?.(editor)
                    ? isDark
                      ? "bg-blue-500 text-white"
                      : "bg-blue-600 text-white"
                    : clsx(
                        isDark
                          ? "text-neutral-200 hover:bg-neutral-800"
                          : "text-neutral-700 hover:bg-neutral-100",
                      ),
                )}
              >
                {button.icon}
              </button>
            ))}
          </div>
          {index < groups.length - 1 ? (
            <span
              className={clsx(
                "h-7 w-px",
                isDark ? "bg-neutral-700" : "bg-neutral-200",
              )}
            />
          ) : null}
        </Fragment>
      ))}
    </div>
  );
}
