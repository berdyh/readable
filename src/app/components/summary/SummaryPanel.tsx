"use client";

import { useCallback, useRef } from "react";

export interface SummaryNote {
  title: string;
  body: React.ReactNode;
}

interface SummaryPanelProps {
  heading: string;
  description?: string;
  notes: SummaryNote[];
  onSelection?: (payload: { text: string; section?: string }) => void;
}

function isNodeInside(container: HTMLElement, node: Node | null): boolean {
  if (!node) {
    return false;
  }

  if (node instanceof HTMLElement) {
    return container.contains(node);
  }

  return container.contains(node.parentElement);
}

const SummaryPanel = ({
  heading,
  description,
  notes,
  onSelection,
}: SummaryPanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseUp = useCallback(() => {
    if (!onSelection) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      return;
    }

    const container = containerRef.current;
    if (!container) {
      return;
    }

    const anchorInside = isNodeInside(container, selection.anchorNode);
    const focusInside = isNodeInside(container, selection.focusNode);

    if (!anchorInside || !focusInside) {
      return;
    }

    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
    const ancestor =
      range?.commonAncestorContainer instanceof Element
        ? range.commonAncestorContainer
        : range?.commonAncestorContainer?.parentElement ?? null;

    const sectionElement =
      ancestor?.closest<HTMLElement>("[data-summary-section]") ?? null;

    const sectionTitle = sectionElement?.dataset.summarySection;

    onSelection({
      text,
      section: sectionTitle ?? undefined,
    });
  }, [onSelection]);

  return (
    <div
      ref={containerRef}
      className="flex h-full flex-col gap-6 text-sm leading-relaxed text-zinc-700"
      onMouseUp={handleMouseUp}
    >
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-400">
          {heading}
        </p>
        {description && (
          <p className="max-w-prose text-sm leading-relaxed text-zinc-600">
            {description}
          </p>
        )}
      </header>

      <div className="flex flex-col gap-5">
        {notes.map((note) => (
          <article
            key={note.title}
            data-summary-section={note.title}
            className="group rounded-xl border border-transparent px-4 py-3 transition hover:border-zinc-200 hover:bg-zinc-50"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {note.title}
            </h3>
            <div className="mt-2 space-y-3 text-sm leading-relaxed text-zinc-700 [&_strong]:font-semibold [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_a]:text-blue-600 [&_a]:underline-offset-4 [&_a:hover]:text-blue-700 [&_a:hover]:underline">
              {note.body}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
};

export default SummaryPanel;
