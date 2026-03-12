"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IHighlight } from "react-pdf-highlighter";
import { X } from "lucide-react";

import FigureCallouts, { type FigureCallout } from "../pdf/FigureCallouts";
import PdfViewerWithHighlights, {
  type PdfHighlightRegion,
  type PdfViewerHandle,
} from "../pdf/PdfViewerWithHighlights";
import type { InlineArxivIngestResult } from "@/server/editor/types";
import type { SummaryResult } from "@/server/summarize/types";

interface WorkspaceModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  isDarkMode?: boolean;
}

const WorkspaceModal = ({
  title,
  open,
  onClose,
  children,
  isDarkMode = false,
}: WorkspaceModalProps) => {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-10">
      <button
        type="button"
        aria-label="Close overlay"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        className={`relative z-10 flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border shadow-2xl ${
          isDarkMode
            ? "border-neutral-700 bg-neutral-900"
            : "border-zinc-200 bg-white"
        }`}
      >
        <div
          className={`flex items-center justify-between border-b px-5 py-3 ${
            isDarkMode ? "border-neutral-700" : "border-zinc-200"
          }`}
        >
          <h2
            className={`text-sm font-semibold uppercase tracking-wide ${
              isDarkMode ? "text-zinc-400" : "text-zinc-500"
            }`}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
              isDarkMode
                ? "border-neutral-600 text-zinc-400 hover:border-neutral-500 hover:text-zinc-300"
                : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
            }`}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div
          className={`max-h-[80vh] overflow-y-auto p-5 ${
            isDarkMode ? "bg-neutral-950" : "bg-zinc-50"
          }`}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

const extractPageNumber = (anchor?: string | null): number | undefined => {
  if (!anchor) {
    return undefined;
  }

  const match = anchor.match(/(\d+)/);
  if (!match) {
    return undefined;
  }

  const value = Number.parseInt(match[1], 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
};

interface PdfPanelProps {
  pdfUrl: string;
  summary: SummaryResult | null;
  arxivHtmlContent: InlineArxivIngestResult | null;
  isDarkMode: boolean;
  onStatus: (message: string) => void;
}

const PdfPanel = ({
  pdfUrl,
  summary,
  arxivHtmlContent,
  isDarkMode,
  onStatus,
}: PdfPanelProps) => {
  const viewerRef = useRef<PdfViewerHandle>(null);
  const [isOpen, setIsOpen] = useState(false);

  const figureCallouts = useMemo<FigureCallout[]>(() => {
    const calloutMap = new Map<string, FigureCallout>();

    if (arxivHtmlContent?.figures?.length) {
      for (const figure of arxivHtmlContent.figures) {
        calloutMap.set(figure.id, {
          id: figure.id,
          label: figure.label,
          caption: figure.caption?.trim() || `Figure ${figure.label || figure.id}`,
          pageNumber: undefined,
          supportingText: undefined,
        });
      }
    }

    if (summary?.figures?.length) {
      for (const figure of summary.figures) {
        const pageNumber = extractPageNumber(figure.page_anchor);
        const caption =
          figure.caption?.trim() ||
          figure.insight?.trim() ||
          "Figure insight unavailable.";
        const supporting = figure.insight?.trim() ? [figure.insight.trim()] : undefined;

        const existing = calloutMap.get(figure.figure_id);
        if (existing) {
          calloutMap.set(figure.figure_id, {
            ...existing,
            pageNumber,
            caption: caption || existing.caption,
            supportingText: supporting || existing.supportingText,
          });
          continue;
        }

        calloutMap.set(figure.figure_id, {
          id: figure.figure_id,
          label: figure.figure_id,
          caption,
          pageNumber,
          supportingText: supporting,
        });
      }
    }

    return Array.from(calloutMap.values());
  }, [arxivHtmlContent, summary]);

  const handlePageJump = useCallback(
    (page: number, options?: { label?: string; region?: PdfHighlightRegion }) => {
      const scroll = () => viewerRef.current?.scrollToPage(page, options?.region);
      scroll();
      window.setTimeout(scroll, 220);
      setIsOpen(true);

      const label = options?.label;
      onStatus(label ? `${label} → page ${page}.` : `Jumped to PDF page ${page}.`);
    },
    [onStatus],
  );

  const handleFigureNavigation = useCallback(
    (figure: FigureCallout) => {
      if (!figure.pageNumber) {
        onStatus(`${figure.label ?? figure.id} is missing a page reference.`);
        return;
      }

      handlePageJump(figure.pageNumber, {
        label: figure.label ?? figure.id,
        region: figure.highlightRegion,
      });
    },
    [handlePageJump, onStatus],
  );

  const handlePdfSelection = useCallback(
    (action: "Explain" | "Ask", highlight: IHighlight) => {
      const text = highlight.content?.text?.trim();
      const page =
        highlight.position?.pageNumber ??
        highlight.position?.boundingRect?.pageNumber ??
        highlight.position?.rects?.[0]?.pageNumber;

      const pageLabel = page ? `page ${page}` : "unknown page";
      const suffix = text ? "" : " (no text captured)";
      onStatus(`${action} selection captured from ${pageLabel}${suffix}.`);
    },
    [onStatus],
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
          isDarkMode
            ? "border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800"
            : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
        }`}
      >
        View PDF panel
      </button>

      <WorkspaceModal
        title="Figures & PDF"
        open={isOpen}
        onClose={() => setIsOpen(false)}
        isDarkMode={isDarkMode}
      >
        <div className="flex flex-col gap-4">
          <div
            className={`rounded-xl border p-4 shadow-sm ${
              isDarkMode
                ? "border-neutral-700 bg-neutral-900"
                : "border-zinc-200 bg-white"
            }`}
          >
            <FigureCallouts figures={figureCallouts} onShow={handleFigureNavigation} />
          </div>
          <div
            className={`rounded-xl border p-4 shadow-sm ${
              isDarkMode
                ? "border-neutral-700 bg-neutral-900"
                : "border-zinc-200 bg-white"
            }`}
          >
            <PdfViewerWithHighlights
              ref={viewerRef}
              pdfUrl={pdfUrl}
              className={`min-h-[65vh] rounded-lg border ${
                isDarkMode
                  ? "border-neutral-700 bg-neutral-900"
                  : "border-zinc-200 bg-white"
              }`}
              onSelectionAction={handlePdfSelection}
            />
          </div>
        </div>
      </WorkspaceModal>
    </>
  );
};

export default PdfPanel;
