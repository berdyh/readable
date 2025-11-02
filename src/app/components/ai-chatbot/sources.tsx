"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Globe, ExternalLink, FileText } from "lucide-react";

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

// Type guard to check if source is AnswerCitation format
function isAnswerCitation(source: Source): source is AnswerCitationSource {
  return 'chunkId' in source;
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
  paperId,
}: {
  sources: Source[];
  className?: string;
  paperId?: string;
}) {
  if (sources.length === 0) return null;

  const handleSourceClick = (
    source: Source,
    event: React.MouseEvent<HTMLAnchorElement | HTMLButtonElement>
  ) => {
    if (isAnswerCitation(source) && paperId) {
      event.preventDefault();
      
      // Dispatch custom event to scroll to block in editor
      const blockNavigationEvent = new CustomEvent("block-editor-navigate", {
        detail: {
          paperId,
          chunkId: source.chunkId,
          page: source.page,
          quote: source.quote,
        },
      });
      window.dispatchEvent(blockNavigationEvent);
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
      <div className="flex items-center gap-2 mb-3 font-semibold text-neutral-700 dark:text-neutral-300">
        <Globe className="h-4 w-4" />
        <span>Sources</span>
      </div>
      <ul className="space-y-2">
        {sources.map((source, index) => {
          const key = isAnswerCitation(source)
            ? source.chunkId || `source-${index}`
            : source.id || `source-${index}`;

          // Handle AnswerCitation format
          if (isAnswerCitation(source)) {
            const displayText = source.quote 
              ? (source.quote.length > 120 ? `${source.quote.slice(0, 120)}...` : source.quote)
              : `Chunk ${source.chunkId}`;
            const hasNavigation = paperId && source.page;

            return (
              <li key={key} className="flex items-start gap-2">
                {hasNavigation ? (
                  <button
                    type="button"
                    onClick={(e) => handleSourceClick(source, e)}
                    className="flex items-start gap-2 text-left text-blue-600 hover:underline dark:text-blue-400 group w-full"
                    title={`Jump to page ${source.page}${source.chunkId ? ` (chunk: ${source.chunkId})` : ''}`}
                  >
                    <FileText className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span className="flex-1">{displayText}</span>
                    {source.page && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400 flex-shrink-0">
                        p. {source.page}
                      </span>
                    )}
                    <ExternalLink className="h-3 w-3 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ) : (
                  <div className="flex items-start gap-2 text-neutral-600 dark:text-neutral-400">
                    <FileText className="h-3 w-3 mt-0.5 flex-shrink-0" />
                    <span className="flex-1">{displayText}</span>
                    {source.page && (
                      <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-1 flex-shrink-0">
                        (p. {source.page})
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          }

          // Handle legacy Source format
          const legacySource = source as LegacySource;
          return (
            <li key={key} className="flex items-start gap-2">
              {legacySource.url ? (
                <a
                  href={legacySource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-blue-600 hover:underline dark:text-blue-400"
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
                <span className="text-neutral-600 dark:text-neutral-400">
                  {legacySource.title}
                  {legacySource.page && (
                    <span className="text-xs text-neutral-500 dark:text-neutral-400 ml-1">
                      (p. {legacySource.page})
                    </span>
                  )}
                </span>
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
  defaultVisible = false,
  paperId,
}: {
  sources?: Source[];
  defaultVisible?: boolean;
  paperId?: string;
}) {
  const [isVisible, setIsVisible] = useState(defaultVisible);

  if (!sources || sources.length === 0) return null;

  if (isVisible) {
    return <SourcesContent sources={sources} paperId={paperId} />;
  }

  return <SourcesTrigger onClick={() => setIsVisible(true)} count={sources.length} />;
}


