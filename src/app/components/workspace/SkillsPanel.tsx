"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";

interface SkillsConcept {
  concept: string;
  description?: string;
  firstSeenPaperId?: string;
  learnedAt?: string;
  confidence?: number;
}

interface SkillsApiResponse {
  userId?: string;
  total?: number;
  concepts: SkillsConcept[];
}

export interface SkillsPanelProps {
  /**
   * When this counter changes, refetch. Caller bumps it after a QA /
   * summary call so newly-extracted concepts show up without a hard
   * refresh.
   */
  refreshKey?: number;
}

function formatLearnedAt(value?: string): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export function SkillsPanel({ refreshKey }: SkillsPanelProps) {
  const { isLoaded, isSignedIn } = useUser();
  const [concepts, setConcepts] = useState<SkillsConcept[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [authRequiredFromApi, setAuthRequiredFromApi] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      return;
    }

    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
        setAuthRequiredFromApi(false);
      }
    });

    fetch("/api/skills", {
      cache: "no-store",
    })
      .then((response) => {
        if (response.status === 401) {
          if (!cancelled) {
            setAuthRequiredFromApi(true);
          }
          return { concepts: [] } as SkillsApiResponse;
        }
        if (!response.ok) {
          throw new Error(`Skills request failed (${response.status}).`);
        }
        return response.json() as Promise<SkillsApiResponse>;
      })
      .then((payload) => {
        if (cancelled) return;
        setConcepts(payload.concepts ?? []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error.");
        setConcepts([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, refreshKey]);

  const authRequired = isLoaded && (!isSignedIn || authRequiredFromApi);
  const visibleConcepts = authRequired ? [] : concepts;
  const visibleError = authRequired ? null : error;
  const isLoading = !isLoaded || (isSignedIn && loading);

  return (
    <aside
      data-testid="skills-panel"
      className="flex w-72 flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900/60 dark:text-zinc-300"
      aria-label="Skills panel"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          Your skills
        </h2>
        <span className="shrink-0 text-[11px] tabular-nums text-zinc-500 dark:text-zinc-400">
          {isLoading ? "Loading…" : `${visibleConcepts?.length ?? 0} concepts`}
        </span>
      </header>

      {authRequired && (
        <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          Sign in to track concepts you encounter.
        </p>
      )}

      {visibleError && (
        <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-400" role="alert">
          {visibleError}
        </p>
      )}

      {!authRequired &&
        !visibleError &&
        visibleConcepts &&
        visibleConcepts.length === 0 &&
        !isLoading && (
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            No concepts yet. Ask a question or generate a summary; encountered concepts will be
            tracked here.
          </p>
        )}

      {visibleConcepts && visibleConcepts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {visibleConcepts.slice(0, 30).map((entry) => (
            <li
              key={entry.concept}
              className="flex max-w-full items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/80 dark:text-zinc-200"
              title={
                entry.description
                  ? `${entry.description}\nFirst seen: ${formatLearnedAt(entry.learnedAt)}`
                  : `First seen: ${formatLearnedAt(entry.learnedAt)}`
              }
            >
              <span className="truncate">{entry.concept}</span>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
