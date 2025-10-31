"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { IHighlight } from "react-pdf-highlighter";
import { X } from "lucide-react";

import PdfViewerWithHighlights, {
  type PdfHighlightRegion,
  type PdfViewerHandle,
} from "../pdf/PdfViewerWithHighlights";
import FigureCallouts, {
  type FigureCallout,
} from "../pdf/FigureCallouts";
import { BlockEditor } from "../block-editor/BlockEditor";
import type { SummaryResult } from "@/server/summarize/types";
import { parseSummaryToBlocks } from "../block-editor/parsers";
import type { Block } from "../block-editor/types";

const DEFAULT_PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf";
const DEFAULT_PAPER_ID = "arxiv:1706.03762";

const inferArxivPdfUrl = (paperId: string | undefined): string | undefined => {
  if (!paperId) {
    return undefined;
  }

  const normalized = paperId.startsWith("arxiv:")
    ? paperId.slice("arxiv:".length)
    : paperId;

  if (!normalized) {
    return undefined;
  }

  return `https://arxiv.org/pdf/${normalized}.pdf`;
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

const isSummaryResult = (value: unknown): value is SummaryResult => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.sections) &&
    Array.isArray(record.key_findings) &&
    Array.isArray(record.figures)
  );
};


interface WorkspaceModalProps {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

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
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-10">
      <button
        type="button"
        aria-label="Close overlay"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-300 text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto bg-zinc-50 p-5">
          {children}
        </div>
      </div>
    </div>
  );
};

const truncateForPrompt = (text: string, maxLength = 320) => {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}…`;
};

export interface ReaderWorkspaceProps {
  paperId?: string;
  pdfUrl?: string;
}

const ReaderWorkspace = ({
  paperId,
  pdfUrl,
}: ReaderWorkspaceProps) => {
  const resolvedPaperId = paperId && paperId.trim() ? paperId : DEFAULT_PAPER_ID;
  const fallbackPdfUrl = inferArxivPdfUrl(resolvedPaperId);
  const resolvedPdfUrl = pdfUrl ?? fallbackPdfUrl ?? DEFAULT_PDF_URL;

  const viewerRef = useRef<PdfViewerHandle>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [personaEnabled, setPersonaEnabled] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const controller = new AbortController();

    const loadSummary = async () => {
      try {
        const response = await fetch("/api/summarize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ paperId: resolvedPaperId }),
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | SummaryResult
          | { error?: string }
          | null;

        if (!response.ok) {
          const message =
            payload &&
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : `Summary request failed with status ${response.status}.`;
          throw new Error(message);
        }

        if (!isSummaryResult(payload)) {
          throw new Error("Summary response was malformed.");
        }

        if (isMounted) {
          setSummary(payload);
        }
      } catch (caught) {
        if (!isMounted || controller.signal.aborted) {
          return;
        }

        const message =
          caught instanceof Error
            ? caught.message
            : "Failed to load summary for this paper.";
        setSummaryError(message);
        setSummary(null);
      } finally {
        if (isMounted) {
          setIsSummaryLoading(false);
        }
      }
    };

    setSummary(null);
    setSummaryError(null);
    setIsSummaryLoading(true);
    void loadSummary();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [resolvedPaperId]);

  useEffect(() => {
    if (!summary) {
      return;
    }
    setStatusMessage((previous) =>
      previous ?? "Summary refreshed from the latest ingest.",
    );
  }, [summary]);

  useEffect(() => {
    if (!summaryError) {
      return;
    }
    setStatusMessage((previous) => previous ?? summaryError);
  }, [summaryError]);

  const handlePageJump = useCallback(
    (
      page: number,
      options?: { label?: string; region?: PdfHighlightRegion },
    ) => {
      const scroll = () => viewerRef.current?.scrollToPage(page, options?.region);
      scroll();
      window.setTimeout(scroll, 220);
      setIsPdfModalOpen(true);

      const label = options?.label;
      setStatusMessage(
        label ? `${label} → page ${page}.` : `Jumped to PDF page ${page}.`,
      );
    },
    [],
  );

  const clearStatus = useCallback(() => {
    setStatusMessage(null);
  }, []);

  useEffect(() => {
    if (!statusMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setStatusMessage(null);
    }, 4200);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [statusMessage]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ text: string }>).detail;
      if (!detail?.text) {
        return;
      }

      setStatusMessage(
        `Notebook note seeded from selection: ${truncateForPrompt(detail.text, 80)}`,
      );
    };

    window.addEventListener("editor-ai-action", handler);
    return () => window.removeEventListener("editor-ai-action", handler);
  }, []);


  const figureCallouts = useMemo<FigureCallout[]>(() => {
    if (!summary?.figures?.length) {
      return [];
    }

    return summary.figures.map((figure) => {
      const pageNumber = extractPageNumber(figure.page_anchor);
      const caption =
        figure.caption?.trim() ||
        figure.insight?.trim() ||
        "Figure insight unavailable.";
      const supporting = figure.insight?.trim()
        ? [figure.insight.trim()]
        : undefined;

      return {
        id: figure.figure_id,
        label: figure.figure_id,
        caption,
        pageNumber,
        supportingText: supporting,
      };
    });
  }, [summary]);

  const handleFigureNavigation = useCallback(
    (figure: FigureCallout) => {
      if (!figure.pageNumber) {
        setStatusMessage(
          `${figure.label ?? figure.id} is missing a page reference.`,
        );
        return;
      }

      handlePageJump(figure.pageNumber, {
        label: figure.label ?? figure.id,
        region: figure.highlightRegion,
      });
    },
    [handlePageJump],
  );

  // Convert summary to blocks for BlockEditor
  const initialBlocks = useMemo<Block[]>(() => {
    if (summary) {
      return parseSummaryToBlocks(summary);
    }
    // Add placeholder blocks for loading/error states
    if (isSummaryLoading) {
      return [
        {
          id: "loading-placeholder",
          type: "paragraph",
          content: `Building a personalized summary for ${resolvedPaperId}…`,
          metadata: {},
        },
      ];
    }
    if (summaryError) {
      return [
        {
          id: "error-placeholder",
          type: "paragraph",
          content: `Summary unavailable: ${summaryError}`,
          metadata: {},
        },
      ];
    }
    return [
      {
        id: "pending-placeholder",
        type: "paragraph",
        content:
          "Waiting for the paper summary pipeline to finish processing. This usually takes a few moments after ingest completes.",
        metadata: {},
      },
    ];
  }, [summary, isSummaryLoading, summaryError, resolvedPaperId]);

  // PDF selection handling - can be enhanced to integrate with BlockEditor's chat
  const handlePdfSelection = useCallback(
    (action: "Explain" | "Ask", highlight: IHighlight) => {
      const text = highlight.content?.text?.trim();
      const page =
        highlight.position?.pageNumber ??
        highlight.position?.boundingRect?.pageNumber ??
        highlight.position?.rects?.[0]?.pageNumber;

      const pageLabel = page ? `page ${page}` : "unknown page";
      const suffix = text ? "" : " (no text captured)";
      setStatusMessage(`${action} selection captured from ${pageLabel}${suffix}.`);
      // TODO: Integrate with BlockEditor's built-in chat
    },
    [],
  );

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans text-zinc-900">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-10">
        <BlockEditor
          paperId={resolvedPaperId}
          initialBlocks={initialBlocks}
          statusMessage={statusMessage}
          errorMessage={summaryError}
          onStatusClear={clearStatus}
          showChatButton={true}
          personaEnabled={personaEnabled}
          onPersonaToggle={setPersonaEnabled}
        />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => setIsPdfModalOpen(true)}
            className="rounded-full border border-zinc-300 px-4 py-2 text-xs font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900"
          >
            View PDF panel
          </button>
        </div>
      </main>


      <WorkspaceModal
        title="Figures & PDF"
        open={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <FigureCallouts
              figures={figureCallouts}
              onShow={handleFigureNavigation}
            />
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
            <PdfViewerWithHighlights
              ref={viewerRef}
              pdfUrl={resolvedPdfUrl}
              className="min-h-[65vh] rounded-lg border border-zinc-200 bg-white"
              onSelectionAction={handlePdfSelection}
            />
          </div>
        </div>
      </WorkspaceModal>
    </div>
  );
};

export default ReaderWorkspace;
