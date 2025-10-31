"use client";

import { useState } from "react";
import { clsx } from "clsx";
import { Maximize2, X, FileImage, ExternalLink } from "lucide-react";
import type { Block } from "../types";

interface FigureBlockProps {
  block: Block;
  paperId?: string;
  isLocked?: boolean;
  onUpdate?: (content: string) => void;
}

/**
 * Figure Block Component
 * Displays figure images from research papers with captions and page anchors
 */
export function FigureBlock({
  block,
  paperId,
  isLocked = false,
  onUpdate,
}: FigureBlockProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imageError, setImageError] = useState(false);

  const figureId = block.metadata?.figureId;
  const imageUrl = block.metadata?.imageUrl;
  const caption = block.metadata?.caption || block.content || "";
  const page = block.metadata?.page;
  const insight = block.metadata?.insight as string | undefined;

  // Handle image load error
  const handleImageError = () => {
    setImageError(true);
  };

  // Open modal to view full-size image
  const handleImageClick = () => {
    if (!isLocked && imageUrl) {
      setIsModalOpen(true);
    }
  };

  // Link to PDF viewer at specific page
  const handlePageLink = () => {
    if (paperId && page !== undefined) {
      // TODO: Implement PDF viewer navigation
      // This could navigate to a PDF viewer route with page anchor
      window.location.href = `/papers/${paperId}?page=${page}`;
    }
  };

  // Render placeholder if no image URL
  if (!imageUrl && !imageError) {
    return (
      <div className="my-4 rounded-lg border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-700 dark:bg-neutral-800">
        <div className="flex items-center gap-2 text-sm text-neutral-500 dark:text-neutral-400">
          <FileImage className="h-4 w-4" />
          <span>
            Figure {figureId ? `(${figureId})` : ""} {page ? `- Page ${page}` : ""}
          </span>
        </div>
        {caption && (
          <div className="mt-2 text-sm text-neutral-700 dark:text-neutral-300">
            {caption}
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        className={clsx(
          "group relative my-4 rounded-lg border transition-colors",
          isLocked
            ? "border-neutral-200 bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800"
            : "border-neutral-300 bg-white hover:border-neutral-400 dark:border-neutral-600 dark:bg-neutral-900 dark:hover:border-neutral-500",
        )}
      >
        {/* Figure Image */}
        <div className="relative">
          {imageError ? (
            <div className="flex min-h-[200px] items-center justify-center bg-neutral-100 dark:bg-neutral-800">
              <div className="text-center">
                <FileImage className="mx-auto h-12 w-12 text-neutral-400" />
                <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">
                  Image failed to load
                </p>
              </div>
            </div>
          ) : (
            <div
              className={clsx(
                "relative cursor-pointer overflow-hidden rounded-t-lg",
                isLocked && "cursor-default",
              )}
              onClick={handleImageClick}
            >
              <img
                src={imageUrl}
                alt={caption || `Figure ${figureId || ""}`}
                className={clsx(
                  "h-auto w-full object-contain transition-transform",
                  !isLocked && "hover:scale-[1.02]",
                )}
                onError={handleImageError}
                loading="lazy"
              />
              {/* Expand button overlay */}
              {!isLocked && imageUrl && (
                <div className="absolute right-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsModalOpen(true);
                    }}
                    className="rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
                    aria-label="Expand figure"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Caption and Metadata */}
        <div className="p-4">
          {/* Figure ID and Page Link */}
          {(figureId || page !== undefined) && (
            <div className="mb-2 flex items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
              {figureId && <span>Figure {figureId}</span>}
              {page !== undefined && (
                <>
                  {figureId && <span>•</span>}
                  <button
                    type="button"
                    onClick={handlePageLink}
                    className="flex items-center gap-1 transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                    title={`View on page ${page}`}
                  >
                    <span>Page {page}</span>
                    <ExternalLink className="h-3 w-3" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Caption */}
          {caption && (
            <div className="mb-2 text-sm font-medium text-neutral-700 dark:text-neutral-300">
              {caption}
            </div>
          )}

          {/* Insight (if available) */}
          {insight && (
            <div className="mt-2 rounded bg-blue-50 p-2 text-xs text-blue-900 dark:bg-blue-950/20 dark:text-blue-200">
              <strong>Insight:</strong> {insight}
            </div>
          )}
        </div>
      </div>

      {/* Full-Size Modal */}
      {isModalOpen && imageUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setIsModalOpen(false)}
        >
          <div className="relative max-h-[90vh] max-w-[90vw]">
            {/* Close button */}
            <button
              type="button"
              onClick={() => setIsModalOpen(false)}
              className="absolute -right-12 top-0 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>

            {/* Full-size image */}
            <img
              src={imageUrl}
              alt={caption || `Figure ${figureId || ""}`}
              className="max-h-[90vh] max-w-[90vw] object-contain"
              onClick={(e) => e.stopPropagation()}
            />

            {/* Caption in modal */}
            {(caption || figureId || page !== undefined) && (
              <div className="mt-4 rounded bg-white/10 p-4 text-white backdrop-blur-sm">
                {figureId && <div className="text-sm font-medium">Figure {figureId}</div>}
                {page !== undefined && (
                  <div className="mt-1 text-xs opacity-80">Page {page}</div>
                )}
                {caption && <div className="mt-2 text-sm">{caption}</div>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

