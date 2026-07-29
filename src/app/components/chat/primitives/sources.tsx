"use client";

import { useState } from "react";
import { clsx } from "clsx";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileText,
  XCircle,
} from "lucide-react";

import {
  emitBlockNavigate,
  onBlockNavigateResult,
  type BlockNavigateStatus,
} from "../../block-editor/navigation";

// Support both the legacy Source format and the AnswerCitation format.
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

type SourceNavigationState = "idle" | "pending" | BlockNavigateStatus;

/** How long to wait for the editor to answer a navigate request before giving up. */
const NAVIGATION_TIMEOUT_MS = 1500;
const QUOTE_CLAMP_LENGTH = 150;

function isAnswerCitation(source: Source): source is AnswerCitationSource {
  return "chunkId" in source;
}

function getSourceKey(source: Source, index: number): string {
  return isAnswerCitation(source)
    ? source.chunkId || `source-${index}`
    : source.id || `source-${index}`;
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
      detail: { action: "source_navigation", status, sourceType, hasPage, count: 1 },
    }),
  );
}

export function SourcesTrigger({ onClick, count }: { onClick: () => void; count: number }) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      className="touch-target relative inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-zinc-500 transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <ChevronDown className="h-3 w-3" />
      Show {count} {count === 1 ? "source" : "sources"}
    </button>
  );
}

function CitationRow({ source, paperId }: { source: AnswerCitationSource; paperId?: string }) {
  const [navigationState, setNavigationState] = useState<SourceNavigationState>("idle");
  const [isExpanded, setIsExpanded] = useState(false);

  const fullText = source.quote || `Chunk ${source.chunkId}`;
  const isExpandable = fullText.length > QUOTE_CLAMP_LENGTH;
  const displayText =
    isExpandable && !isExpanded ? `${fullText.slice(0, QUOTE_CLAMP_LENGTH)}…` : fullText;
  const hasNavigation = Boolean(paperId && source.chunkId);

  const handleClick = () => {
    if (!paperId) return;

    const hasPage = typeof source.page === "number";
    setNavigationState("pending");
    emitSourceProofCounter({ status: "pending", sourceType: "answer-citation", hasPage });

    const requestId = emitBlockNavigate({
      paperId,
      chunkId: source.chunkId,
      page: source.page,
      quote: source.quote,
    });

    let completed = false;
    const stopListening = onBlockNavigateResult(requestId, (status) => {
      completed = true;
      setNavigationState(status);
      emitSourceProofCounter({ status, sourceType: "answer-citation", hasPage });
    });

    window.setTimeout(() => {
      if (completed) return;
      stopListening();
      setNavigationState((current) => (current === "pending" ? "unavailable" : current));
      emitSourceProofCounter({ status: "unavailable", sourceType: "answer-citation", hasPage });
    }, NAVIGATION_TIMEOUT_MS);
  };

  const isFailed = navigationState === "unavailable" || !hasNavigation;
  const StatusIcon = navigationState === "success" ? CheckCircle2 : isFailed ? XCircle : FileText;
  const statusTone =
    navigationState === "success"
      ? "text-emerald-600 dark:text-emerald-400"
      : isFailed
        ? "text-amber-700 dark:text-amber-400"
        : "text-zinc-400 dark:text-zinc-500";

  // Only speak up once the row has something to report. An idle row is
  // self-evidently clickable and does not need a line of instructions.
  const statusText =
    navigationState === "success"
      ? "Opened in the paper."
      : navigationState === "pending"
        ? "Opening…"
        : navigationState === "unavailable"
          ? "Not found in the current paper view."
          : !hasNavigation
            ? "Source location unavailable."
            : null;

  const body = (
    <>
      <StatusIcon className={clsx("mt-0.5 h-3.5 w-3.5 shrink-0", statusTone)} />
      <span className="min-w-0 flex-1">
        <span className="block text-zinc-700 dark:text-zinc-200">{displayText}</span>
        {statusText && (
          <span className={clsx("mt-1 block text-xs", statusTone)} aria-live="polite">
            {statusText}
          </span>
        )}
      </span>
      {source.page && (
        <span className="shrink-0 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          p. {source.page}
        </span>
      )}
    </>
  );

  return (
    <li
      className={clsx(
        "rounded-md border transition-colors duration-150",
        navigationState === "success"
          ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900/70 dark:bg-emerald-950/20"
          : isFailed
            ? "border-amber-200 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/20"
            : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950/60",
      )}
    >
      {hasNavigation ? (
        <button
          type="button"
          onClick={handleClick}
          className="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors duration-150 hover:bg-emerald-50/70 dark:hover:bg-emerald-950/20"
          title={`Jump to chunk ${source.chunkId}${source.page ? ` (page ${source.page})` : ""}`}
        >
          {body}
          <ExternalLink
            className="mt-0.5 h-3 w-3 shrink-0 text-zinc-400 dark:text-zinc-500"
            aria-hidden="true"
          />
        </button>
      ) : (
        <div className="flex items-start gap-2 px-3 py-2 text-zinc-600 dark:text-zinc-400">
          {body}
        </div>
      )}

      {isExpandable && (
        <button
          type="button"
          onClick={() => setIsExpanded((expanded) => !expanded)}
          aria-expanded={isExpanded}
          className="inline-flex min-h-8 items-center gap-1 px-3 pb-2 text-xs font-medium text-zinc-500 transition-colors duration-150 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {isExpanded ? "Show less" : "Show more"}
        </button>
      )}
    </li>
  );
}

function LegacyRow({ source }: { source: LegacySource }) {
  return (
    <li className="rounded-md border border-zinc-200 bg-white px-3 py-2 dark:border-zinc-800 dark:bg-zinc-950/60">
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-emerald-700 underline-offset-2 hover:underline dark:text-emerald-400"
          onClick={() =>
            emitSourceProofCounter({
              status: "success",
              sourceType: "legacy",
              hasPage: typeof source.page === "number",
            })
          }
        >
          <span>{source.title}</span>
          {source.page && (
            <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
              p. {source.page}
            </span>
          )}
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      ) : (
        <div className="text-zinc-600 dark:text-zinc-400">
          <span>
            {source.title}
            {source.page && (
              <span className="ml-1 text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                p. {source.page}
              </span>
            )}
          </span>
          <span className="mt-1 block text-xs text-amber-700 dark:text-amber-400">
            Source link unavailable.
          </span>
        </div>
      )}
    </li>
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
  if (sources.length === 0) return null;

  return (
    <div className={clsx("text-sm", className)}>
      <ul className="space-y-1.5">
        {sources.map((source, index) => {
          const key = getSourceKey(source, index);
          return isAnswerCitation(source) ? (
            <CitationRow key={key} source={source} paperId={paperId} />
          ) : (
            <LegacyRow key={key} source={source} />
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
