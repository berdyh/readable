"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IHighlight } from "react-pdf-highlighter";
import { FileText, X } from "lucide-react";

import FigureCallouts, { type FigureCallout } from "./FigureCallouts";
import PdfViewerWithHighlights, {
  type PdfHighlightRegion,
  type PdfViewerHandle,
} from "./PdfViewerWithHighlights";
import type { InlineArxivIngestResult } from "@/server/editor/types";
import type { SummaryResult } from "@/server/summarize/types";

interface WorkspaceModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * Theming is Tailwind `dark:` variants rather than a JS `isDarkMode` flag, so
 * the server and the first client render emit identical class strings — the
 * same hydration-safe rule the rest of the reader follows.
 */
const WorkspaceModal = ({ title, open, onClose, children }: WorkspaceModalProps) => {
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-10"
    >
      <button
        type="button"
        aria-label="Close overlay"
        onClick={onClose}
        className="absolute inset-0 bg-zinc-950/50 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="touch-target relative inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-zinc-500 transition-colors duration-150 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[82vh] overflow-y-auto bg-zinc-50 p-4 dark:bg-zinc-950">
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
  onStatus: (message: string) => void;
}

const PdfPanel = ({ pdfUrl, summary, arxivHtmlContent, onStatus }: PdfPanelProps) => {
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
          imageUrl: figure.imageUrl,
          pageNumber: undefined,
          supportingText: undefined,
        });
      }
    }

    if (summary?.figures?.length) {
      for (const figure of summary.figures) {
        const pageNumber = extractPageNumber(figure.page_anchor);
        const caption =
          figure.caption?.trim() || figure.insight?.trim() || "Figure insight unavailable.";
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
        className="inline-flex h-9 items-center gap-2 rounded-full border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-700 transition-colors duration-150 hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <FileText className="h-3.5 w-3.5" aria-hidden="true" />
        Figures / PDF
      </button>

      <WorkspaceModal title="Figures & PDF" open={isOpen} onClose={() => setIsOpen(false)}>
        <div className="grid min-h-[70vh] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
          <section
            className="min-w-0 overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            aria-label="PDF viewer"
          >
            <PdfViewerWithHighlights
              ref={viewerRef}
              pdfUrl={pdfUrl}
              className="h-[70vh] min-h-[520px]"
              onSelectionAction={handlePdfSelection}
            />
          </section>
          <aside
            className="min-h-0 overflow-y-auto border-t border-zinc-200 pt-4 lg:max-h-[70vh] lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0 dark:border-zinc-800"
            aria-label="Figure callouts"
          >
            <FigureCallouts figures={figureCallouts} onShow={handleFigureNavigation} />
          </aside>
        </div>
      </WorkspaceModal>
    </>
  );
};

export default PdfPanel;
