"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Globe, ExternalLink } from "lucide-react";

interface Source {
  id: string;
  title: string;
  url?: string;
  page?: number;
}

export function SourcesTrigger({
  onClick,
  count,
}: {
  onClick: () => void;
  count: number;
}) {
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
      <span>{count} {count === 1 ? "source" : "sources"}</span>
    </button>
  );
}

export function SourcesContent({
  sources,
  className,
}: {
  sources: Source[];
  className?: string;
}) {
  if (sources.length === 0) return null;

  return (
    <div
      className={clsx(
        "rounded-lg border px-4 py-3 text-sm",
        "border-neutral-200 bg-neutral-50",
        "dark:border-neutral-700 dark:bg-neutral-900/50",
        className,
      )}
    >
      <div className="flex items-center gap-2 mb-3 font-semibold text-neutral-700 dark:text-neutral-300">
        <Globe className="h-4 w-4" />
        <span>Sources</span>
      </div>
      <ul className="space-y-2">
        {sources.map((source) => (
          <li key={source.id} className="flex items-start gap-2">
            {source.url ? (
              <a
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-blue-600 hover:underline dark:text-blue-400"
              >
                <span>{source.title}</span>
                {source.page && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400">
                    (p. {source.page})
                  </span>
                )}
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="text-neutral-600 dark:text-neutral-400">
                {source.title}
                {source.page && (
                  <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-1">
                    (p. {source.page})
                  </span>
                )}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sources({
  sources,
  defaultVisible = false,
}: {
  sources?: Source[];
  defaultVisible?: boolean;
}) {
  const [isVisible, setIsVisible] = useState(defaultVisible);

  if (!sources || sources.length === 0) return null;

  if (isVisible) {
    return <SourcesContent sources={sources} />;
  }

  return <SourcesTrigger onClick={() => setIsVisible(true)} count={sources.length} />;
}


