"use client";

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
  userId: string;
  total: number;
  concepts: SkillsConcept[];
}

export interface SkillsPanelProps {
  userId?: string;
  isDarkMode: boolean;
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

export function SkillsPanel({ userId, isDarkMode, refreshKey }: SkillsPanelProps) {
  const [concepts, setConcepts] = useState<SkillsConcept[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      // Defer to a microtask so setState doesn't run synchronously
      // inside the effect body — keeps the React Compiler / Next 16
      // lint rule happy without changing observable behaviour.
      queueMicrotask(() => {
        if (!cancelled) {
          setConcepts([]);
          setLoading(false);
          setError(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    queueMicrotask(() => {
      if (!cancelled) {
        setLoading(true);
        setError(null);
      }
    });

    fetch(`/api/skills/${encodeURIComponent(userId)}`, {
      cache: "no-store",
    })
      .then((response) => {
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
  }, [userId, refreshKey]);

  const containerBase = isDarkMode
    ? "border-neutral-800 bg-neutral-900/60 text-neutral-300"
    : "border-neutral-200 bg-white text-neutral-700";

  const chipBase = isDarkMode
    ? "border-neutral-700 bg-neutral-800/80 text-neutral-200"
    : "border-neutral-200 bg-neutral-100 text-neutral-700";

  return (
    <aside
      data-testid="skills-panel"
      className={`flex w-72 flex-col gap-2 rounded-xl border p-4 ${containerBase}`}
      aria-label="Skills panel"
    >
      <header className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="h-4 w-4" /> Your skills
        </h2>
        <span className="text-[10px] uppercase tracking-wide opacity-60">
          {loading ? "loading…" : `${concepts?.length ?? 0} concepts`}
        </span>
      </header>

      {!userId && (
        <p className="text-xs opacity-70">Sign in to track concepts you encounter.</p>
      )}

      {error && (
        <p className="text-xs text-amber-500" role="alert">
          {error}
        </p>
      )}

      {userId && !error && concepts && concepts.length === 0 && !loading && (
        <p className="text-xs opacity-70">
          No concepts yet. Ask a question or generate a summary; encountered
          concepts will be tracked here.
        </p>
      )}

      {concepts && concepts.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {concepts.slice(0, 30).map((entry) => (
            <li
              key={entry.concept}
              className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${chipBase}`}
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
