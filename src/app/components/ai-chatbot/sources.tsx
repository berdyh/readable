"use client";

import { useState } from "react";
import { clsx } from "clsx";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  Globe,
  XCircle,
} from "lucide-react";

// Support both legacy Source format and AnswerCitation format
interface LegacySource {
  id: string;
  title: string;
  url?: string;
  page?: number;
}

interface AnswerCitationSource {
  chunkId: string;
  page?: number;
  quote?: string;
}

export type Source = LegacySource | AnswerCitationSource;

type SourceNavigationState = "idle" | "pending" | "success" | "unavailable";

interface SourceNavigationResult {
  requestId: string;
  status: "success" | "unavailable";
}

// Type guard to check if source is AnswerCitation format
function isAnswerCitation(source: Source): source is AnswerCitationSource {
  return "chunkId" in source;
}

function getSourceKey(source: Source, index: number): string {
  return isAnswerCitation(source)
    ? source.chunkId || `source-${index}`
    : source.id || `source-${index}`;
}

function createNavigationRequestId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `source-nav-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emitSourceProofCounter({
  status,
  sourceType,
  hasPage,
}: {
  status: SourceNavigationState;
  sourceType: "answer-citation" | "legacy";
  hasPage: boolean;
}) {
  window.dispatchEvent(
    new CustomEvent("readable-source-proof-counter", {
      detail: {
        action: "source_navigation",
        status,
        sourceType,
        hasPage,
        count: 1,
      },
    }),
  );
}

export function SourcesTrigger({ onClick, count }: { onClick: () => void; count: number }) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors",
        "border-neutral-200 bg-neutral-50 text-neutral-700 hover:bg-neutral-100",
        "dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700",
      )}
    >
      <Globe className="h-3 w-3" />
      <span>
        {count} {count === 1 ? "source" : "sources"}
      </span>
    </button>
  );
}

export function SourcesContent({
  sources,
  className,
  paperId,
}: {
  sources: Source[];
  className?: string;
  paperId?: string;
}) {
  const [navigationStates, setNavigationStates] = useState<Record<string, SourceNavigationState>>(
    {},
  );
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});

  if (sources.length === 0) return null;

  const handleSourceClick = (
    source: Source,
    sourceId: string,
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
  ) => {
    if (isAnswerCitation(source) && paperId) {
      event.preventDefault();
      const requestId = createNavigationRequestId();
      const hasPage = typeof source.page === "number";

      setNavigationStates((current) => ({ ...current, [sourceId]: "pending" }));
      emitSourceProofCounter({ status: "pending", sourceType: "answer-citation", hasPage });

      let completed = false;
      const handleResult = (resultEvent: Event) => {
        const detail = (resultEvent as CustomEvent<SourceNavigationResult>).detail;
        if (!detail || detail.requestId !== requestId) {
          return;
        }

        completed = true;
        window.removeEventListener("block-editor-navigate-result", handleResult);
        const status = detail.status === "success" ? "success" : "unavailable";
        setNavigationStates((current) => ({ ...current, [sourceId]: status }));
        emitSourceProofCounter({ status, sourceType: "answer-citation", hasPage });
      };

      window.addEventListener("block-editor-navigate-result", handleResult);

      window.dispatchEvent(
        new CustomEvent("block-editor-navigate", {
          detail: {
            requestId,
            paperId,
            chunkId: source.chunkId,
            page: source.page,
            quote: source.quote,
          },
        }),
      );

      window.setTimeout(() => {
        if (completed) {
          return;
        }

        window.removeEventListener("block-editor-navigate-result", handleResult);
        setNavigationStates((current) =>
          current[sourceId] === "pending" ? { ...current, [sourceId]: "unavailable" } : current,
        );
        emitSourceProofCounter({
          status: "unavailable",
          sourceType: "answer-citation",
          hasPage,
        });
      }, 1500);
    }
  };

  return (
    <div
      className={clsx(
        "rounded-lg border px-4 py-3 text-sm",
        "border-neutral-200 bg-neutral-50",
        "dark:border-neutral-700 dark:bg-neutral-900/50",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2 text-neutral-700 dark:text-neutral-300">
        <div className="flex items-center gap-2 font-semibold">
          <Globe className="h-4 w-4" />
          <span>Sources</span>
        </div>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-500 ring-1 ring-neutral-200 dark:bg-neutral-950 dark:text-neutral-400 dark:ring-neutral-800">
          {sources.length} {sources.length === 1 ? "source" : "sources"}
        </span>
      </div>
      <ul className="space-y-2">
        {sources.map((source, index) => {
          const key = getSourceKey(source, index);
          const navigationState = navigationStates[key] ?? "idle";

          if (isAnswerCitation(source)) {
            const fullText = source.quote || `Chunk ${source.chunkId}`;
            const isExpandable = fullText.length > 150;
            const isExpanded = expandedRows[key] ?? false;
            const displayText =
              isExpandable && !isExpanded ? `${fullText.slice(0, 150)}...` : fullText;
            const hasNavigation = Boolean(paperId && source.chunkId);
            const statusText =
              navigationState === "success"
                ? "Source opened in the paper."
                : navigationState === "pending"
                  ? "Opening source..."
                  : navigationState === "unavailable"
                    ? "Source location unavailable in the current paper view."
                    : hasNavigation
                      ? "Open source in paper."
                      : "Source location unavailable.";
            const StatusIcon =
              navigationState === "success"
                ? CheckCircle2
                : navigationState === "unavailable" || !hasNavigation
                  ? XCircle
                  : FileText;
            const statusClassName =
              navigationState === "success"
                ? "text-emerald-600 dark:text-emerald-400"
                : navigationState === "unavailable" || !hasNavigation
                  ? "text-amber-700 dark:text-amber-300"
                  : "text-neutral-500 dark:text-neutral-400";

            return (
              <li
                key={key}
                className={clsx(
                  "rounded-md border px-3 py-2",
                  navigationState === "success" &&
                    "border-emerald-200 bg-emerald-50 dark:border-emerald-900/70 dark:bg-emerald-950/20",
                  (navigationState === "unavailable" || !hasNavigation) &&
                    "border-amber-200 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/20",
                  navigationState !== "success" &&
                    navigationState !== "unavailable" &&
                    hasNavigation &&
                    "border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950/60",
                )}
              >
                {hasNavigation ? (
                  <button
                    type="button"
                    onClick={(event) => handleSourceClick(source, key, event)}
                    className="group flex w-full items-start gap-2 text-left text-blue-700 transition hover:text-blue-800 dark:text-blue-300 dark:hover:text-blue-200"
                    title={`Jump to chunk ${source.chunkId}${source.page ? ` (page ${source.page})` : ""}`}
                  >
                    <StatusIcon
                      className={clsx("mt-0.5 h-3.5 w-3.5 flex-shrink-0", statusClassName)}
                    />
                    <span className="flex-1">
                      <span className="block text-neutral-700 dark:text-neutral-200">
                        {displayText}
                      </span>
                      <span
                        className={clsx("mt-1 block text-xs", statusClassName)}
                        aria-live="polite"
                      >
                        {statusText}
                      </span>
                    </span>
                    {source.page && (
                      <span className="flex-shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                        p. {source.page}
                      </span>
                    )}
                    <ExternalLink className="mt-0.5 h-3 w-3 flex-shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                  </button>
                ) : (
                  <div className="flex items-start gap-2 text-neutral-600 dark:text-neutral-400">
                    <StatusIcon
                      className={clsx("mt-0.5 h-3.5 w-3.5 flex-shrink-0", statusClassName)}
                    />
                    <span className="flex-1">
                      <span className="block">{displayText}</span>
                      <span className={clsx("mt-1 block text-xs", statusClassName)}>
                        {statusText}
                      </span>
                    </span>
                    {source.page && (
                      <span className="ml-1 flex-shrink-0 text-xs text-neutral-500 dark:text-neutral-400">
                        (p. {source.page})
                      </span>
                    )}
                  </div>
                )}
                {isExpandable && (
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRows((current) => ({ ...current, [key]: !isExpanded }))
                    }
                    className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? (
                      <>
                        <ChevronUp className="h-3 w-3" />
                        Show less
                      </>
                    ) : (
                      <>
                        <ChevronDown className="h-3 w-3" />
                        Show more
                      </>
                    )}
                  </button>
                )}
              </li>
            );
          }

          const legacySource = source as LegacySource;
          return (
            <li
              key={key}
              className="rounded-md border border-neutral-200 bg-white px-3 py-2 dark:border-neutral-800 dark:bg-neutral-950/60"
            >
              {legacySource.url ? (
                <a
                  href={legacySource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() =>
                    emitSourceProofCounter({
                      status: "success",
                      sourceType: "legacy",
                      hasPage: typeof legacySource.page === "number",
                    })
                  }
                >
                  <span>{legacySource.title}</span>
                  {legacySource.page && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
                      (p. {legacySource.page})
                    </span>
                  )}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : (
                <div className="text-neutral-600 dark:text-neutral-400">
                  <span>
                    {legacySource.title}
                    {legacySource.page && (
                      <span className="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
                        (p. {legacySource.page})
                      </span>
                    )}
                  </span>
                  <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">
                    Source link unavailable.
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function Sources({
  sources,
  defaultVisible = true,
  paperId,
  className,
}: {
  sources?: Source[];
  defaultVisible?: boolean;
  paperId?: string;
  className?: string;
}) {
  const [isVisible, setIsVisible] = useState(defaultVisible);

  if (!sources || sources.length === 0) return null;

  if (isVisible) {
    return <SourcesContent sources={sources} paperId={paperId} className={className} />;
  }

  return <SourcesTrigger onClick={() => setIsVisible(true)} count={sources.length} />;
}
