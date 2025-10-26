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

import ChatPanel from "../chat/ChatPanel";
import PdfViewerWithHighlights, {
  type PdfHighlightRegion,
  type PdfViewerHandle,
} from "../pdf/PdfViewerWithHighlights";
import FigureCallouts, {
  type FigureCallout,
} from "../pdf/FigureCallouts";
import type { SummaryNote } from "../summary/SummaryPanel";
import type { QuestionSelection } from "@/server/qa/types";
import { ResearchEditor } from "../editor/ResearchEditor";
import type { SummaryResult } from "@/server/summarize/types";

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

const PageReference = ({
  page,
  onJump,
}: {
  page: number;
  onJump: (page: number) => void;
}) => (
  <button
    type="button"
    onClick={() => onJump(page)}
    className="font-medium text-blue-600 underline-offset-4 transition hover:text-blue-700 hover:underline"
  >
    (page {page})
  </button>
);

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
  const [chatDraft, setChatDraft] = useState("");
  const [selection, setSelection] = useState<QuestionSelection | undefined>();
  const [personaEnabled, setPersonaEnabled] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isChatModalOpen, setIsChatModalOpen] = useState(false);
  const [isPdfModalOpen, setIsPdfModalOpen] = useState(false);
  const [summarySelection, setSummarySelection] = useState<
    { text: string; section?: string } | null
  >(null);
  const [isSummaryActionOpen, setIsSummaryActionOpen] = useState(false);

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

  const handleSummarySelection = useCallback(
    ({ text, section }: { text: string; section?: string }) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }

      setSummarySelection({ text: normalized, section });
      setIsSummaryActionOpen(true);
      setStatusMessage("Choose how you'd like to follow up on that highlight.");
    },
    [],
  );

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

  const summaryNotes = useMemo<SummaryNote[]>(() => {
    if (summary) {
      const notes: SummaryNote[] = [];

      if (summary.key_findings?.length) {
        notes.push({
          title: "Key findings",
          body: (
            <ul className="space-y-3">
              {summary.key_findings.map((finding, index) => {
                const evidencePage = extractPageNumber(
                  finding.page_anchors?.[0],
                );

                return (
                  <li key={`finding-${index}`} className="space-y-2">
                    <p className="font-medium text-zinc-700">
                      {finding.statement}
                    </p>
                    <p className="text-sm leading-relaxed text-zinc-600">
                      {finding.evidence}
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                      {evidencePage ? (
                        <span className="inline-flex items-center gap-1">
                          Evidence <PageReference page={evidencePage} onJump={handlePageJump} />
                        </span>
                      ) : null}
                      {finding.supporting_sections?.length ? (
                        <span>
                          Sections: {finding.supporting_sections.join(", ")}
                        </span>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          ),
        });
      }

      summary.sections.forEach((section, index) => {
        const anchorPage =
          extractPageNumber(section.page_anchor) ??
          section.page_span?.start ??
          section.page_span?.end;

        notes.push({
          title: section.title || `Section ${index + 1}`,
          body: (
            <div className="space-y-3">
              <p className="text-sm leading-relaxed text-zinc-700">
                {section.summary}
              </p>
              {section.reasoning ? (
                <p className="text-sm leading-relaxed text-zinc-500">
                  {section.reasoning}
                </p>
              ) : null}
              {section.key_points?.length ? (
                <ul className="space-y-2 text-sm leading-relaxed text-zinc-700">
                  {section.key_points.map((point, pointIndex) => (
                    <li key={`${section.section_id ?? index}-point-${pointIndex}`}>
                      {point}
                    </li>
                  ))}
                </ul>
              ) : null}
              {anchorPage ? (
                <div className="text-xs text-zinc-500">
                  <PageReference page={anchorPage} onJump={handlePageJump} />
                </div>
              ) : null}
            </div>
          ),
        });
      });

      if (notes.length) {
        return notes;
      }
    }

    if (isSummaryLoading) {
      return [
        {
          title: "Generating summary",
          body: (
            <p className="text-sm leading-relaxed text-zinc-600">
              Building a personalized summary for{" "}
              <span className="font-medium">{resolvedPaperId}</span>…
            </p>
          ),
        },
      ];
    }

    if (summaryError) {
      return [
        {
          title: "Summary unavailable",
          body: (
            <p className="text-sm leading-relaxed text-red-600">
              {summaryError}
            </p>
          ),
        },
      ];
    }

    return [
      {
        title: "Summary pending",
        body: (
          <p className="text-sm leading-relaxed text-zinc-600">
            Waiting for the paper summary pipeline to finish processing. This
            usually takes a few moments after ingest completes.
          </p>
        ),
      },
    ];
  }, [summary, isSummaryLoading, summaryError, handlePageJump, resolvedPaperId]);

  const handlePdfSelection = useCallback(
    (action: "Explain" | "Ask", highlight: IHighlight) => {
      const text = highlight.content?.text?.trim();
      const page =
        highlight.position?.pageNumber ??
        highlight.position?.boundingRect?.pageNumber ??
        highlight.position?.rects?.[0]?.pageNumber;

      if (text) {
        const snippet = truncateForPrompt(text);
        const prompt =
          action === "Explain"
            ? `Explain this passage in context:\n“${snippet}”`
            : `Answer this question about the passage:\n“${snippet}”`;

        setChatDraft(prompt);
        setSelection({
          text,
          page,
          section: page ? `PDF page ${page}` : "PDF highlight",
        });
        setIsChatModalOpen(true);
      }

      const pageLabel = page ? `page ${page}` : "unknown page";
      const suffix = text ? "" : " (no text captured)";
      setStatusMessage(`${action} selection captured from ${pageLabel}${suffix}.`);
    },
    [],
  );

  type SummaryFollowUp = "deep-dive" | "quick-explain";

  const handleSummaryFollowUp = useCallback(
    (mode: SummaryFollowUp) => {
      if (!summarySelection) {
        return;
      }

      const snippet = truncateForPrompt(summarySelection.text);
      const contextSuffix = summarySelection.section
        ? `\n\nContext: ${summarySelection.section}`
        : "";

      const prompt =
        mode === "deep-dive"
          ? `Explain why this part matters:\n“${snippet}”${contextSuffix}`
          : `Give me a quick explanation of this passage:\n“${snippet}”${contextSuffix}`;

      setChatDraft(prompt);
      setSelection({
        text: summarySelection.text,
        section: summarySelection.section,
      });
      setIsSummaryActionOpen(false);
      setSummarySelection(null);
      setIsChatModalOpen(true);
      setStatusMessage(
        mode === "deep-dive"
          ? "Deep dive prompt ready in chat."
          : "Quick explanation prompt ready in chat.",
      );
    },
    [summarySelection],
  );

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans text-zinc-900">
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-10">
        <ResearchEditor
          summaryNotes={summaryNotes}
          summaryDescription="Structured bullets stay narrow for readability. Highlight any passage to tee up a follow-up question."
          onSummarySelection={handleSummarySelection}
          onOpenChat={() => setIsChatModalOpen(true)}
          onOpenPdf={() => setIsPdfModalOpen(true)}
          statusMessage={statusMessage}
          onStatusClear={clearStatus}
        />
      </main>

      <WorkspaceModal
        title="How should we follow up?"
        open={isSummaryActionOpen}
        onClose={() => {
          setIsSummaryActionOpen(false);
          setSummarySelection(null);
        }}
      >
        <div className="flex flex-col gap-4">
          {summarySelection ? (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 text-sm leading-relaxed text-zinc-700 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                Selected passage
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                “{truncateForPrompt(summarySelection.text, 280)}”
              </p>
              {summarySelection.section ? (
                <p className="mt-3 text-xs text-zinc-500">
                  Context: {summarySelection.section}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => handleSummaryFollowUp("deep-dive")}
              className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-700"
            >
              Deep dive
            </button>
            <button
              type="button"
              onClick={() => handleSummaryFollowUp("quick-explain")}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-300 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900"
            >
              Quick explanation
            </button>
          </div>
        </div>
      </WorkspaceModal>

      <WorkspaceModal
        title="Research chat"
        open={isChatModalOpen}
        onClose={() => setIsChatModalOpen(false)}
      >
        <div className="flex flex-col gap-4">
          <ChatPanel
            paperId={resolvedPaperId}
            draft={chatDraft}
            onDraftChange={setChatDraft}
            selection={selection}
            onSelectionClear={() => setSelection(undefined)}
            personaEnabled={personaEnabled}
            onPersonaToggle={setPersonaEnabled}
            onQuestionSent={(question) =>
              setStatusMessage(`Asked: ${truncateForPrompt(question, 140)}`)
            }
            onAnswerReceived={(answer) =>
              setStatusMessage(`Answer ready – ${truncateForPrompt(answer, 120)}`)
            }
            onError={(error) => setStatusMessage(error)}
          />
        </div>
      </WorkspaceModal>

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
