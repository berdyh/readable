"use client";

import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { clsx } from "clsx";

import { Reasoning } from "./reasoning";
import { Sources, type Source } from "./sources";

/**
 * The render-time view of trust, deliberately wider than any single wire shape:
 * it has to accept a fresh `/api/qa` answer (`AnswerTrustMetadata` in
 * `@/server/qa/types`), a persisted history row (`ChatTrustMetadata` in
 * `@/server/chat/types`), and older rows that predate both. `model/types.ts`
 * asserts at compile time that both wire shapes still fit here.
 */
export interface TrustDisplayMetadata {
  state?: string;
  status?: string;
  label?: string;
  summary?: string;
  reason?: string;
  warnings?: string[];
  confidence?: number | string;
  sourceCount?: number;
}

type TrustTone = "trusted" | "partial" | "error" | "legacy" | "neutral";

const TRUSTED_STATES = ["sourced", "trusted", "grounded", "verified", "supported", "high"];
const PARTIAL_STATES = ["uncited", "partial", "mixed", "low", "medium", "needs_review"];
const ERROR_STATES = ["refused", "error", "failed"];

function getTrustState({
  status,
  trust,
  sourceCount,
}: {
  status?: "error";
  trust?: TrustDisplayMetadata;
  sourceCount: number;
}): { tone: TrustTone; label: string; detail: string } {
  if (status === "error") {
    return {
      tone: "error",
      label: "Answer unavailable",
      detail: "The chat request failed. Try again or ask a narrower question.",
    };
  }

  const normalizedState = (trust?.state ?? trust?.status)?.toLowerCase();
  const detail =
    trust?.summary ??
    trust?.reason ??
    trust?.warnings?.[0] ??
    (sourceCount > 0
      ? `Every claim below can be opened in the paper.`
      : "No clickable source proof was returned for this answer.");

  if (!normalizedState) {
    return {
      tone: sourceCount > 0 ? "legacy" : "neutral",
      label: sourceCount > 0 ? "Legacy answer" : "Source proof unavailable",
      detail,
    };
  }

  if (TRUSTED_STATES.includes(normalizedState)) {
    return { tone: "trusted", label: trust?.label ?? "Grounded answer", detail };
  }

  if (PARTIAL_STATES.includes(normalizedState)) {
    return { tone: "partial", label: trust?.label ?? "Evidence needs review", detail };
  }

  if (ERROR_STATES.includes(normalizedState)) {
    return { tone: "error", label: trust?.label ?? "Answer unavailable", detail };
  }

  return {
    tone: "neutral",
    label:
      normalizedState === "unavailable"
        ? (trust?.label ?? "Source proof unavailable")
        : (trust?.label ?? "Source proof unknown"),
    detail,
  };
}

const TRUST_TONE_CLASSES: Record<TrustTone, string> = {
  trusted:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/70 dark:bg-emerald-950/30 dark:text-emerald-200",
  partial:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-200",
  error:
    "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200",
  legacy:
    "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300",
  neutral:
    "border-zinc-200 bg-zinc-50 text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300",
};

/**
 * The trust-first header. It is the first thing in the card because whether an
 * answer is grounded matters more than what it says.
 */
function AnswerTrustStrip({
  status,
  trust,
  sourceCount,
}: {
  status?: "error";
  trust?: TrustDisplayMetadata;
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
        TRUST_TONE_CLASSES[trustState.tone],
      )}
    >
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <div className="font-medium">{trustState.label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed opacity-90">{trustState.detail}</div>
      </div>
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
  trust?: TrustDisplayMetadata;
  reasoning?: string;
  paperId: string;
  status?: "error";
  className?: string;
}) {
  const sourceCount = citations?.length ?? 0;
  const isError = status === "error";

  return (
    <div className={clsx("flex min-w-0 flex-col items-start gap-1.5", className)}>
      <article
        className={clsx(
          "w-full overflow-hidden rounded-lg border",
          isError
            ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900/70 dark:bg-rose-950/30 dark:text-rose-200"
            : "border-zinc-200 bg-white text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-100",
        )}
      >
        <AnswerTrustStrip status={status} trust={trust} sourceCount={sourceCount} />

        <div className="whitespace-pre-wrap break-words px-4 py-3 text-sm leading-relaxed">
          {content}
        </div>

        {sourceCount > 0 && (
          <section className="border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Sources · <span className="tabular-nums">{sourceCount}</span>
            </h4>
            <Sources sources={citations} defaultVisible paperId={paperId} />
          </section>
        )}

        {isError && (
          <p className="border-t border-rose-200 px-4 py-2 text-xs leading-relaxed dark:border-rose-900/70">
            Try again from the composer, or ask a narrower question if the source set is large.
          </p>
        )}
      </article>

      {reasoning && <Reasoning content={reasoning} />}
    </div>
  );
}
