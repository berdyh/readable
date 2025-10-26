"use client";

import clsx from "clsx";

import type { PdfHighlightRegion } from "./PdfViewerWithHighlights";

export interface FigureCallout {
  id: string;
  label?: string;
  caption: string;
  pageNumber?: number;
  referencedSections?: string[];
  supportingText?: string[];
  highlightRegion?: PdfHighlightRegion;
}

interface FigureCalloutsProps {
  figures: FigureCallout[];
  onShow: (figure: FigureCallout) => void;
  className?: string;
}

const truncate = (value: string, maxLength = 220): string => {
  const normalized = value.trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength)}…`;
};

const FigureCallouts = ({
  figures,
  onShow,
  className,
}: FigureCalloutsProps) => {
  if (!figures.length) {
    return (
      <div className={clsx("flex flex-col gap-3", className)}>
        <header className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
            Figures
          </span>
        </header>
        <p className="text-sm leading-relaxed text-zinc-500">
          Figures referenced in the paper will appear here once parsing is
          complete.
        </p>
      </div>
    );
  }

  return (
    <div className={clsx("flex flex-col gap-4", className)}>
      <header className="flex flex-col gap-1">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">
          Figures
        </span>
        <p className="text-xs leading-relaxed text-zinc-500">
          Callouts include the caption and destination page. Tap any figure to
          jump to its region in the PDF.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {figures.map((figure) => {
          const captionPreview = truncate(figure.caption);
          const primaryContext = figure.supportingText?.[0];
          const pageLabel =
            typeof figure.pageNumber === "number" && figure.pageNumber > 0
              ? figure.pageNumber
              : "—";

          return (
            <article
              key={figure.id}
              className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 transition hover:border-zinc-300 hover:bg-white"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    <span>{figure.label ?? `Figure ${figure.id}`}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600">
                      page {pageLabel}
                    </span>
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-700">
                    {captionPreview}
                  </p>
                  {primaryContext ? (
                    <p className="text-xs leading-relaxed text-zinc-500">
                      Referenced context: {truncate(primaryContext, 160)}
                    </p>
                  ) : null}
                  {figure.referencedSections?.length ? (
                    <p className="text-xs text-zinc-500">
                      Sections: {figure.referencedSections.join(", ")}
                    </p>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => onShow(figure)}
                  className="inline-flex shrink-0 items-center justify-center rounded-md border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900"
                >
                  Show figure
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};

export default FigureCallouts;
