"use client";

import { useState } from "react";
import clsx from "clsx";

import type { PdfHighlightRegion } from "./PdfViewerWithHighlights";

export interface FigureCallout {
  id: string;
  label?: string;
  caption: string;
  imageUrl?: string;
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

const FigureCallouts = ({ figures, onShow, className }: FigureCalloutsProps) => {
  const [previewFigure, setPreviewFigure] = useState<FigureCallout | null>(null);

  if (!figures.length) {
    return (
      <div className={clsx("flex flex-col gap-3", className)}>
        <header className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            Figures
          </span>
        </header>
        <p className="text-sm leading-relaxed text-zinc-500 dark:text-zinc-400">
          Figures referenced in the paper will appear here once parsing is complete.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className={clsx("flex flex-col gap-4", className)}>
        <header className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500 dark:text-zinc-400">
            Figures
          </span>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Callouts include the caption and destination page. Tap any figure to jump to its region
            in the PDF.
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
            const canShowFigure = typeof figure.pageNumber === "number" && figure.pageNumber > 0;
            const canPreviewImage = Boolean(figure.imageUrl);

            return (
              <article
                key={figure.id}
                className="rounded-lg border border-zinc-200 bg-zinc-50/70 p-3 transition hover:border-zinc-300 hover:bg-white dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                      <span>{figure.label ?? `Figure ${figure.id}`}</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-600 dark:bg-blue-950/40 dark:text-blue-200">
                        page {pageLabel}
                      </span>
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-700 dark:text-zinc-200">
                      {captionPreview}
                    </p>
                    {figure.imageUrl ? (
                      <button
                        type="button"
                        onClick={() => setPreviewFigure(figure)}
                        className="group overflow-hidden rounded-md border border-zinc-200 bg-white text-left transition hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-700"
                        aria-label={`Preview ${figure.label ?? figure.id}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- figure images come from
                            arbitrary arXiv/ar5iv hosts extracted at ingest time. next/image needs each
                            host declared in remotePatterns up front, which is impossible for a URL set
                            that is only known once a paper is ingested. */}
                        <img
                          src={figure.imageUrl}
                          alt={figure.label ?? `Figure ${figure.id}`}
                          className="max-h-40 w-full object-contain p-2 transition group-hover:scale-[1.01]"
                          loading="lazy"
                        />
                      </button>
                    ) : null}
                    {primaryContext ? (
                      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                        Referenced context: {truncate(primaryContext, 160)}
                      </p>
                    ) : null}
                    {figure.referencedSections?.length ? (
                      <p className="text-xs text-zinc-500 dark:text-zinc-400">
                        Sections: {figure.referencedSections.join(", ")}
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (canShowFigure) {
                        onShow(figure);
                        return;
                      }
                      if (canPreviewImage) {
                        setPreviewFigure(figure);
                      }
                    }}
                    disabled={!canShowFigure && !canPreviewImage}
                    className="inline-flex h-8 min-w-[6.5rem] shrink-0 items-center justify-center rounded-md border border-zinc-300 px-3 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-zinc-300 disabled:hover:text-zinc-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-600 dark:hover:text-zinc-100 dark:disabled:hover:border-zinc-700 dark:disabled:hover:text-zinc-300"
                  >
                    {canShowFigure ? "Show figure" : canPreviewImage ? "View image" : "No page"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
      {previewFigure?.imageUrl ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4 py-8">
          <button
            type="button"
            aria-label="Close figure preview"
            className="absolute inset-0"
            onClick={() => setPreviewFigure(null)}
          />
          <figure className="relative z-10 flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
              <figcaption className="min-w-0 text-sm font-medium text-zinc-100">
                {previewFigure.label ?? `Figure ${previewFigure.id}`}
              </figcaption>
              <button
                type="button"
                onClick={() => setPreviewFigure(null)}
                className="inline-flex h-8 items-center justify-center rounded-md border border-zinc-700 px-3 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:text-white"
              >
                Close
              </button>
            </div>
            <div className="min-h-0 overflow-auto bg-white p-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- figure images come from
                  arbitrary arXiv/ar5iv hosts extracted at ingest time. next/image needs each
                  host declared in remotePatterns up front, which is impossible for a URL set
                  that is only known once a paper is ingested. */}
              <img
                src={previewFigure.imageUrl}
                alt={previewFigure.caption}
                className="mx-auto max-h-[72vh] w-auto max-w-full object-contain"
              />
            </div>
            <p className="max-h-28 overflow-y-auto border-t border-zinc-800 px-4 py-3 text-xs leading-relaxed text-zinc-300">
              {previewFigure.caption}
            </p>
          </figure>
        </div>
      ) : null}
    </>
  );
};

export default FigureCallouts;
