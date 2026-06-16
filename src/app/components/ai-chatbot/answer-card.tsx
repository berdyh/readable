"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { clsx } from "clsx";

import { Reasoning } from "./reasoning";
import { Sources, type Source } from "./sources";

export interface AnswerTrustMetadata {
  state?: string;
  status?: string;
  label?: string;
  summary?: string;
  reason?: string;
  warnings?: string[];
  confidence?: number | string;
  sourceCount?: number;
}

function getTrustState({
  status,
  trust,
  sourceCount,
}: {
  status?: "error";
  trust?: AnswerTrustMetadata;
  sourceCount: number;
}) {
  if (status === "error") {
    return {
      tone: "error" as const,
      label: "Answer unavailable",
      detail: "The chat request failed. Try again or ask a narrower question.",
    };
  }

  const rawState = trust?.state ?? trust?.status;
  const normalizedState = rawState?.toLowerCase();
  const detail =
    trust?.summary ??
    trust?.reason ??
    trust?.warnings?.[0] ??
    (sourceCount > 0
      ? `${sourceCount} ${sourceCount === 1 ? "source" : "sources"} available below.`
      : "No clickable source proof was returned for this answer.");

  if (!normalizedState) {
    return {
      tone: sourceCount > 0 ? ("legacy" as const) : ("neutral" as const),
      label: sourceCount > 0 ? "Legacy answer" : "Source proof unavailable",
      detail,
    };
  }

  if (
    ["sourced", "trusted", "grounded", "verified", "supported", "high"].includes(
      normalizedState,
    )
  ) {
    return {
      tone: "trusted" as const,
      label: trust?.label ?? "Grounded answer",
      detail,
    };
  }

  if (["uncited", "partial", "mixed", "low", "medium", "needs_review"].includes(normalizedState)) {
    return {
      tone: "partial" as const,
      label: trust?.label ?? "Evidence needs review",
      detail,
    };
  }

  if (["refused", "error", "failed"].includes(normalizedState)) {
    return {
      tone: "error" as const,
      label: trust?.label ?? "Answer unavailable",
      detail,
    };
  }

  return {
    tone: "neutral" as const,
    label:
      normalizedState === "unavailable"
        ? (trust?.label ?? "Source proof unavailable")
        : (trust?.label ?? "Source proof unknown"),
    detail,
  };
}

function AnswerTrustStrip({
  status,
  trust,
  sourceCount,
}: {
  status?: "error";
  trust?: AnswerTrustMetadata;
  sourceCount: number;
}) {
  const trustState = getTrustState({ status, trust, sourceCount });
  const Icon =
    trustState.tone === "trusted"
      ? CheckCircle2
      : trustState.tone === "partial" || trustState.tone === "error"
        ? AlertTriangle
        : Info;

  return (
    <div
      className={clsx(
        "flex items-start gap-2 border-b px-4 py-2 text-xs",
        trustState.tone === "trusted" &&
          "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200",
        trustState.tone === "partial" &&
          "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200",
        trustState.tone === "error" &&
          "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200",
        (trustState.tone === "legacy" || trustState.tone === "neutral") &&
          "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300",
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{trustState.label}</div>
        <div className="mt-0.5 text-[11px] opacity-90">{trustState.detail}</div>
      </div>
    </div>
  );
}

function ProvenanceStrip({ sourceCount }: { sourceCount: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-2 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
      <span>Provenance</span>
      <span>
        {sourceCount > 0
          ? `${sourceCount} clickable ${sourceCount === 1 ? "source" : "sources"}`
          : "No source rows returned"}
      </span>
    </div>
  );
}

export function AnswerCard({
  content,
  citations,
  trust,
  reasoning,
  paperId,
  status,
  className,
}: {
  content: string;
  citations?: Source[];
  trust?: AnswerTrustMetadata;
  reasoning?: string;
  paperId: string;
  status?: "error";
  className?: string;
}) {
  const sourceCount = citations?.length ?? 0;
  const isError = status === "error";

  return (
    <div className={clsx("flex flex-col items-start gap-2", className)}>
      <article
        className={clsx(
          "overflow-hidden rounded-lg border shadow-sm",
          isError
            ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"
            : "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
        )}
      >
        <AnswerTrustStrip status={status} trust={trust} sourceCount={sourceCount} />
        <div className="whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed">
          {content}
        </div>
        <ProvenanceStrip sourceCount={sourceCount} />

        {citations && citations.length > 0 && (
          <Sources
            sources={citations}
            defaultVisible
            paperId={paperId}
            className="rounded-none border-x-0 border-b-0 border-t-0 bg-transparent shadow-none"
          />
        )}

        {isError && (
          <div className="border-t border-rose-200 px-4 py-2 text-xs dark:border-rose-900/70">
            Try again from the composer, or ask a narrower question if the source set is large.
          </div>
        )}
      </article>

      {reasoning && <Reasoning content={reasoning} />}
    </div>
  );
}
