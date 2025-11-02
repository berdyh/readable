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
import { X, SunMedium, MoonStar } from "lucide-react";
import { useTheme } from "next-themes";

import PdfViewerWithHighlights, {
  type PdfHighlightRegion,
  type PdfViewerHandle,
} from "../pdf/PdfViewerWithHighlights";
import FigureCallouts, {
  type FigureCallout,
} from "../pdf/FigureCallouts";
import { BlockEditor } from "../block-editor/BlockEditor";
import type { SummaryResult } from "@/server/summarize/types";
import { parseSummaryToBlocks, parseArxivHtmlToBlocks } from "../block-editor/parsers";
import type { Block } from "../block-editor/types";
import type { InlineArxivIngestResult } from "@/server/editor/types";

const DEFAULT_PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf";
const DEFAULT_PAPER_ID = "arxiv:1706.03762";

const normalizeArxivId = (paperId: string | undefined): string | undefined => {
  if (!paperId) {
    return undefined;
  }

  // Remove "arxiv:" prefix if present
  let normalized = paperId.startsWith("arxiv:")
    ? paperId.slice("arxiv:".length)
    : paperId;

  // Remove version suffix (e.g., "v7" from "1706.03762v7")
  normalized = normalized.replace(/v\d+$/i, "");

  // Check if it looks like an arxiv ID (format: YYYY.MMMM or YYYY.MMMMM)
  if (/^\d{4}\.\d{4,5}$/.test(normalized)) {
    return normalized;
  }

  return undefined;
};

const inferArxivPdfUrl = (paperId: string | undefined): string | undefined => {
  const normalized = normalizeArxivId(paperId);
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
  isDarkMode?: boolean;
}

const WorkspaceModal = ({ title, open, onClose, children, isDarkMode = false }: WorkspaceModalProps) => {
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
      <div className={`relative z-10 flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border shadow-2xl ${
        isDarkMode
          ? "border-neutral-700 bg-neutral-900"
          : "border-zinc-200 bg-white"
      }`}>
        <div className={`flex items-center justify-between border-b px-5 py-3 ${
          isDarkMode
            ? "border-neutral-700"
            : "border-zinc-200"
        }`}>
          <h2 className={`text-sm font-semibold uppercase tracking-wide ${
            isDarkMode
              ? "text-zinc-400"
              : "text-zinc-500"
          }`}>
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
        <div className={`max-h-[80vh] overflow-y-auto p-5 ${
          isDarkMode
            ? "bg-neutral-950"
            : "bg-zinc-50"
        }`}>
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
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  const viewerRef = useRef<PdfViewerHandle>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [arxivHtmlContent, setArxivHtmlContent] = useState<InlineArxivIngestResult | null>(null);
  const [isHtmlLoading, setIsHtmlLoading] = useState(false);
  const [htmlError, setHtmlError] = useState<string | null>(null);
  const [personaEnabled, setPersonaEnabled] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);

  // Handle theme mounting
  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkMode = mounted && resolvedTheme === "dark";
  const toggleTheme = () => {
    setTheme(isDarkMode ? "light" : "dark");
  };

  // Try to fetch HTML content for arxiv papers first
  useEffect(() => {
    const arxivId = normalizeArxivId(resolvedPaperId);
    if (!arxivId) {
      // Not an arxiv paper, skip HTML fetch
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const loadHtmlContent = async () => {
      setIsHtmlLoading(true);
      setHtmlError(null);

      try {
        const response = await fetch("/api/editor/ingest/arxiv", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ target: arxivId }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          const message =
            payload?.error ??
            `HTML fetch failed with status ${response.status}.`;
          throw new Error(message);
        }

        const result = (await response.json()) as InlineArxivIngestResult;

        if (isMounted) {
          setArxivHtmlContent(result);
          setStatusMessage("Paper content loaded from HTML.");
        }
      } catch (caught) {
        if (!isMounted || controller.signal.aborted) {
          return;
        }

        // HTML fetch failed - this is expected for some papers, so we'll fall back to summary
        console.warn("[ReaderWorkspace] HTML fetch failed, falling back to summary:", caught);
        setHtmlError(
          caught instanceof Error
            ? caught.message
            : "Failed to load HTML content.",
        );
      } finally {
        if (isMounted) {
          setIsHtmlLoading(false);
        }
      }
    };

    void loadHtmlContent();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [resolvedPaperId]);

  // Load summary for figure page numbers and other metadata
  // Even when HTML is available, we still want summary data for figures
  useEffect(() => {
    // Skip if summary is already loaded or we're still loading HTML
    // (We'll load summary after HTML finishes loading)
    if (summary || isHtmlLoading) {
      return;
    }

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
  }, [resolvedPaperId, summary, isHtmlLoading]);

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
    const calloutMap = new Map<string, FigureCallout>();

    // First, add figures from HTML content (if available)
    if (arxivHtmlContent?.figures?.length) {
      for (const figure of arxivHtmlContent.figures) {
        const caption = figure.caption?.trim() || `Figure ${figure.label || figure.id}`;
        const callout: FigureCallout = {
          id: figure.id,
          label: figure.label,
          caption,
          pageNumber: undefined, // HTML figures don't have page numbers
          supportingText: undefined,
        };
        calloutMap.set(figure.id, callout);
      }
    }

    // Then, add or merge figures from summary (prefer summary data when available)
    if (summary?.figures?.length) {
      for (const figure of summary.figures) {
        const pageNumber = extractPageNumber(figure.page_anchor);
        const caption = figure.caption?.trim() || 
          figure.insight?.trim() || 
          "Figure insight unavailable.";
        const supporting = figure.insight?.trim()
          ? [figure.insight.trim()]
          : undefined;

        // If we already have this figure from HTML, merge the data (prefer summary)
        const existing = calloutMap.get(figure.figure_id);
        if (existing) {
          // Update with summary data (which has page info)
          existing.pageNumber = pageNumber;
          existing.caption = caption || existing.caption;
          existing.supportingText = supporting || existing.supportingText;
        } else {
          // Add new figure from summary
          calloutMap.set(figure.figure_id, {
            id: figure.figure_id,
            label: figure.figure_id,
            caption,
            pageNumber,
            supportingText: supporting,
          });
        }
      }
    }

    return Array.from(calloutMap.values());
  }, [summary, arxivHtmlContent]);

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

  // Convert content to blocks for BlockEditor - prioritize HTML over summary
  const initialBlocks = useMemo<Block[]>(() => {
    // If we have HTML content, use it
    if (arxivHtmlContent) {
      return parseArxivHtmlToBlocks(arxivHtmlContent);
    }

    // If we're loading HTML, show loading message
    if (isHtmlLoading) {
      return [
        {
          id: "html-loading-placeholder",
          type: "paragraph",
          content: `Loading paper content for ${resolvedPaperId}…`,
          metadata: {},
        },
      ];
    }

    // If HTML failed but we have summary, use summary
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
    if (summaryError && htmlError) {
      // Both HTML and summary failed
      return [
        {
          id: "error-placeholder",
          type: "paragraph",
          content: `Unable to load content: ${htmlError}. Trying summary pipeline...`,
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
  }, [arxivHtmlContent, summary, isHtmlLoading, isSummaryLoading, summaryError, htmlError, resolvedPaperId]);

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
    <div className={`flex min-h-screen flex-col font-sans ${isDarkMode ? "bg-neutral-950 text-neutral-100" : "bg-zinc-50 text-zinc-900"}`}>
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
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={toggleTheme}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition ${
              isDarkMode
                ? "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
            }`}
            title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDarkMode ? (
              <SunMedium className="h-4 w-4" />
            ) : (
              <MoonStar className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setIsPdfModalOpen(true)}
            className={`rounded-full border px-4 py-2 text-xs font-semibold transition ${
              isDarkMode
                ? "border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-600 hover:bg-neutral-800"
                : "border-zinc-300 bg-white text-zinc-700 hover:border-zinc-400 hover:text-zinc-900"
            }`}
          >
            View PDF panel
          </button>
        </div>
      </main>


      <WorkspaceModal
        title="Figures & PDF"
        open={isPdfModalOpen}
        onClose={() => setIsPdfModalOpen(false)}
        isDarkMode={isDarkMode}
      >
        <div className="flex flex-col gap-4">
          <div className={`rounded-xl border p-4 shadow-sm ${
            isDarkMode
              ? "border-neutral-700 bg-neutral-900"
              : "border-zinc-200 bg-white"
          }`}>
            <FigureCallouts
              figures={figureCallouts}
              onShow={handleFigureNavigation}
            />
          </div>
          <div className={`rounded-xl border p-4 shadow-sm ${
            isDarkMode
              ? "border-neutral-700 bg-neutral-900"
              : "border-zinc-200 bg-white"
          }`}>
            <PdfViewerWithHighlights
              ref={viewerRef}
              pdfUrl={resolvedPdfUrl}
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
    </div>
  );
};

export default ReaderWorkspace;
