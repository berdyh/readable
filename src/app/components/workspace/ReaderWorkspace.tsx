"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { IHighlight } from "react-pdf-highlighter";

import ChatPanel from "../chat/ChatPanel";
import PdfViewerWithHighlights, {
  type PdfHighlightRegion,
  type PdfViewerHandle,
} from "../pdf/PdfViewerWithHighlights";
import FigureCallouts, {
  type FigureCallout,
} from "../pdf/FigureCallouts";
import SummaryPanel, {
  type SummaryNote,
} from "../summary/SummaryPanel";
import type { QuestionSelection } from "@/server/qa/types";
import { ResearchEditor } from "../editor/ResearchEditor";
import type { SummaryResult } from "@/server/summarize/types";

const DEFAULT_PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf";
const DEFAULT_PAPER_ID = "arxiv:1706.03762";

type MobilePane = "summary" | "chat" | "pdf";

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

const mobilePaneOptions: Array<{ key: MobilePane; label: string }> = [
  { key: "summary", label: "Summary" },
  { key: "chat", label: "Chat" },
  { key: "pdf", label: "PDF" },
];

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

const StatusCallout = ({
  message,
  onClear,
}: {
  message: string | null;
  onClear: () => void;
}) => {
  if (!message) {
    return null;
  }

  return (
    <div className="inline-flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">
      <span className="font-medium">Updated:</span>
      <span className="line-clamp-2">{message}</span>
      <button
        type="button"
        onClick={onClear}
        className="text-xs font-semibold uppercase tracking-wide text-blue-500"
      >
        Dismiss
      </button>
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
  const [mobilePane, setMobilePane] = useState<MobilePane>("summary");
  const [chatDraft, setChatDraft] = useState("");
  const [selection, setSelection] = useState<QuestionSelection | undefined>();
  const [personaEnabled, setPersonaEnabled] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPdfOpen, setIsPdfOpen] = useState(false);

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
      viewerRef.current?.scrollToPage(page, options?.region);
      setIsPdfOpen(true);
      setMobilePane("pdf");

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
      const snippet = truncateForPrompt(text);

      setChatDraft(
        `Explain why this part matters:\n“${snippet}”${
          section ? `\n\nContext: ${section}` : ""
        }`,
      );

      setSelection({
        text: text.trim(),
        section,
      });

      setMobilePane("chat");
      setStatusMessage("Summary highlight added to chat prompt.");
    },
    [],
  );

  const handleMobilePaneChange = useCallback((next: MobilePane) => {
    setMobilePane(next);
    if (next === "pdf") {
      setIsPdfOpen(true);
    }
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
        setMobilePane("chat");
      }

      const pageLabel = page ? `page ${page}` : "unknown page";
      const suffix = text ? "" : " (no text captured)";
      setStatusMessage(`${action} selection captured from ${pageLabel}${suffix}.`);
    },
    [],
  );

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans text-zinc-900">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-5 py-10 lg:grid lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-10">
        <aside className="hidden lg:block">
          <div className="sticky top-8 flex max-h-[calc(100vh-6rem)] flex-col gap-6 overflow-y-auto pb-8">
            <SummaryPanel
              heading="Summary at a glance"
              description="Structured bullets stay narrow for readability. Highlight any passage to tee up a follow-up question."
              notes={summaryNotes}
              onSelection={handleSummarySelection}
            />
          </div>
        </aside>

        <section className="flex flex-col gap-6">
          <ResearchEditor />

          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              Reader workspace
            </h1>
            <p className="text-sm leading-relaxed text-zinc-600">
              Minimalist research flow tying PLAN.md “UI/UX notes” to the new
              API endpoints. Use the slash menu or highlight text to ask
              grounded follow-ups.
            </p>
            <StatusCallout message={statusMessage} onClear={clearStatus} />
          </div>

          <div className="lg:hidden">
            <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white p-1 text-xs font-medium text-zinc-600 shadow-sm">
              {mobilePaneOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => handleMobilePaneChange(option.key)}
                  className={`flex-1 rounded-full px-3 py-2 transition ${
                    mobilePane === option.key
                      ? "bg-zinc-900 text-white"
                      : "text-zinc-600 hover:bg-zinc-100"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className={`${
              mobilePane === "summary" ? "flex" : "hidden"
            } lg:hidden`}
          >
            <SummaryPanel
              heading="Summary at a glance"
              description="Highlight here to seed a question; tap PDFs when you need full context."
              notes={summaryNotes}
              onSelection={handleSummarySelection}
            />
          </div>

          <div
            className={`${
              mobilePane === "chat" ? "flex" : "hidden"
            } lg:flex lg:flex-col`}
          >
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
                setStatusMessage(
                  `Answer ready – ${truncateForPrompt(answer, 120)}`,
                )
              }
              onError={(error) => setStatusMessage(error)}
            />
          </div>

          <div
            className={`${
              mobilePane === "pdf" ? "flex" : "hidden"
            } lg:flex lg:flex-col`}
          >
            <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <FigureCallouts
                figures={figureCallouts}
                onShow={handleFigureNavigation}
              />
            </div>

            <div className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    PDF viewer
                  </h2>
                  <p className="text-xs text-zinc-500">
                    Open when you want to inspect the original pages.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPdfOpen((value) => !value)}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                >
                  {isPdfOpen ? "Hide PDF" : "Open PDF"}
                </button>
              </div>

              {isPdfOpen ? (
                <PdfViewerWithHighlights
                  ref={viewerRef}
                  pdfUrl={resolvedPdfUrl}
                  className="min-h-[65vh] rounded-lg border border-zinc-200 bg-white"
                  onSelectionAction={handlePdfSelection}
                />
              ) : (
                <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-300 bg-zinc-50 px-6 py-12 text-center text-sm text-zinc-500">
                  <p>
                    Keep focus on the summary and chat. Open the PDF when you
                    need to verify citations or explore figures.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsPdfOpen(true)}
                    className="inline-flex items-center gap-2 rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
                  >
                    Launch PDF
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};

export default ReaderWorkspace;
