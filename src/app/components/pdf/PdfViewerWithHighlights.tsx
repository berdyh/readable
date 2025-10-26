"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  PdfHighlighter,
  PdfLoader,
  Highlight as PdfHighlight,
} from "react-pdf-highlighter";
import type {
  Content,
  IHighlight,
  LTWHP,
  Scaled,
  ScaledPosition,
} from "react-pdf-highlighter";
import { pdfjs } from "react-pdf";
import clsx from "clsx";

const PDFJS_WORKER_URL =
  "https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.js";
const PDFJS_STANDARD_FONT_URL =
  "https://unpkg.com/pdfjs-dist@5.4.296/standard_fonts/";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
  pdfjs.GlobalWorkerOptions.standardFontDataUrl = PDFJS_STANDARD_FONT_URL;
}

type SelectionAction = "Explain" | "Ask";

export interface PdfHighlightRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfViewerHandle {
  scrollToPage: (pageNumber: number, region?: PdfHighlightRegion) => void;
}

interface PdfViewerWithHighlightsProps {
  pdfUrl: string;
  className?: string;
  onSelectionAction?: (action: SelectionAction, highlight: IHighlight) => void;
}

interface HighlightMeta {
  kind: "user" | "transient";
  source?: "navigation" | "selection";
}

interface HighlightOptions {
  includeComment?: boolean;
  meta?: HighlightMeta;
}

type HighlightEntry = IHighlight & {
  action: SelectionAction;
  meta?: HighlightMeta;
};

type ViewportHighlight = HighlightEntry & {
  position: {
    boundingRect: LTWHP;
    rects: Array<LTWHP>;
  };
};

const ActionEmojis: Record<SelectionAction, string> = {
  Explain: "💡",
  Ask: "❓",
};

const SelectionToolbar = ({
  text,
  onAction,
}: {
  text: string;
  onAction: (action: SelectionAction) => void;
}): ReactElement => {
  const truncated = useMemo(() => text.trim().slice(0, 140), [text]);

  return (
    <div className="flex w-60 flex-col gap-3 rounded-md border border-zinc-200 bg-white p-3 shadow-md">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        Selection
      </div>
      <div className="max-h-24 overflow-y-auto rounded border border-zinc-100 bg-zinc-50 p-2 text-sm leading-relaxed text-zinc-700">
        {truncated}
        {text.trim().length > truncated.length ? "…" : ""}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => onAction("Explain")}
          className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-zinc-700"
        >
          Explain
        </button>
        <button
          type="button"
          onClick={() => onAction("Ask")}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900"
        >
          Ask
        </button>
      </div>
    </div>
  );
};

const HighlightPreview = ({
  highlight,
  onRemove,
}: {
  highlight: HighlightEntry;
  onRemove: (id: string) => void;
}): ReactElement => {
  return (
    <div className="flex w-64 flex-col gap-2 rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-lg">
      <div className="flex items-center justify-between text-xs uppercase tracking-wide text-zinc-500">
        <span>Action</span>
        <span className="flex items-center gap-1 font-medium text-zinc-700">
          <span aria-hidden>{ActionEmojis[highlight.action]}</span>
          {highlight.action}
        </span>
      </div>
      {highlight.content.text && (
        <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-zinc-700">
          {highlight.content.text}
        </p>
      )}
      <button
        type="button"
        onClick={() => onRemove(highlight.id)}
        className="self-end text-xs font-semibold text-red-500 transition hover:text-red-600"
      >
        Remove highlight
      </button>
    </div>
  );
};

const createHighlightId = () =>
  `highlight-${Math.random().toString(36).slice(2, 10)}-${Date.now()}`;

const makeHighlightEntry = (
  position: ScaledPosition,
  content: Content,
  action: SelectionAction,
  options?: HighlightOptions,
): HighlightEntry => {
  const includeComment = options?.includeComment ?? true;

  return {
    id: createHighlightId(),
    position,
    content,
    action,
    comment: includeComment
      ? {
          text: action,
          emoji: ActionEmojis[action],
        }
      : {
          text: "",
          emoji: "",
        },
    meta: options?.meta,
  };
};

const clamp01 = (value: number): number => {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
};

const MIN_REGION_SIZE = 0.05;

const createRegionRect = (
  pageNumber: number,
  region?: PdfHighlightRegion,
): Scaled => {
  if (!region) {
    return {
      x1: 0,
      y1: 0,
      x2: 1,
      y2: 1,
      width: 1,
      height: 1,
      pageNumber,
    };
  }

  const x = clamp01(region.x);
  const y = clamp01(region.y);
  const width = clamp01(Math.max(region.width, MIN_REGION_SIZE));
  const height = clamp01(Math.max(region.height, MIN_REGION_SIZE));

  const x2 = clamp01(x + Math.min(width, 1 - x));
  const y2 = clamp01(y + Math.min(height, 1 - y));

  return {
    x1: x,
    y1: y,
    x2,
    y2,
    width: x2 - x,
    height: y2 - y,
    pageNumber,
  };
};

type HighlightState = Record<string, HighlightEntry[]>;

const PdfViewerWithHighlights = forwardRef<
  PdfViewerHandle,
  PdfViewerWithHighlightsProps
>(({ pdfUrl, className, onSelectionAction }, ref) => {
  const [highlightMap, setHighlightMap] = useState<HighlightState>({});
  const [transientHighlight, setTransientHighlight] =
    useState<HighlightEntry | null>(null);
  const scrollToRef = useRef<((highlight: HighlightEntry) => void) | null>(null);
  const transientTimeoutRef = useRef<number | null>(null);

  const highlights = useMemo(
    () => highlightMap[pdfUrl] ?? [],
    [highlightMap, pdfUrl],
  );

  const activeHighlights = useMemo(() => {
    if (!transientHighlight) {
      return highlights;
    }
    return [transientHighlight, ...highlights];
  }, [highlights, transientHighlight]);

  useEffect(() => {
    return () => {
      if (transientTimeoutRef.current !== null) {
        window.clearTimeout(transientTimeoutRef.current);
      }
    };
  }, []);

  const updateHighlightsForUrl = useCallback(
    (updater: (prev: HighlightEntry[]) => HighlightEntry[]) => {
      setHighlightMap((prev) => {
        const current = prev[pdfUrl] ?? [];
        const next = updater(current);

        if (next === current) {
          return prev;
        }

        return {
          ...prev,
          [pdfUrl]: next,
        };
      });
    },
    [pdfUrl],
  );

  useImperativeHandle(ref, () => ({
    scrollToPage(pageNumber: number, region?: PdfHighlightRegion) {
      if (!scrollToRef.current) {
        return;
      }

      const boundingRect = createRegionRect(pageNumber, region);
      const placeholderHighlight = makeHighlightEntry(
        {
          pageNumber,
          boundingRect,
          rects: [boundingRect],
        },
        { text: "" },
        "Explain",
        {
          includeComment: false,
          meta: {
            kind: "transient",
            source: "navigation",
          },
        },
      );

      setTransientHighlight(placeholderHighlight);

      if (transientTimeoutRef.current !== null) {
        window.clearTimeout(transientTimeoutRef.current);
      }

      transientTimeoutRef.current = window.setTimeout(() => {
        setTransientHighlight(null);
      }, 2400);

      scrollToRef.current(placeholderHighlight);
    },
  }));

  const removeHighlight = useCallback((id: string) => {
    updateHighlightsForUrl((prev) => prev.filter((item) => item.id !== id));
  }, [updateHighlightsForUrl]);

  const handleSelectionAction = useCallback(
    (action: SelectionAction, position: ScaledPosition, content: Content) => {
      const newHighlight = makeHighlightEntry(position, content, action, {
        meta: {
          kind: "user",
          source: "selection",
        },
      });
      updateHighlightsForUrl((prev) => [newHighlight, ...prev]);
      onSelectionAction?.(action, newHighlight);
    },
    [onSelectionAction, updateHighlightsForUrl],
  );

  const renderHighlight = useCallback(
    (
      highlight: ViewportHighlight,
      _index: number,
      setTip: (
        highlight: ViewportHighlight,
        render: (highlight: ViewportHighlight) => ReactElement,
      ) => void,
      hideTip: () => void,
      _viewportToScaled: unknown,
      _screenshot: unknown,
      isScrolledTo: boolean,
    ) => (
      highlight.meta?.kind === "transient" ? (
        <div
          key={highlight.id}
          className={clsx(
            "absolute pointer-events-none rounded-md border-2 border-sky-500/60 bg-sky-400/20 shadow-[0_0_0_2px_rgba(56,189,248,0.3)] transition-opacity duration-500",
            isScrolledTo ? "opacity-100" : "opacity-0",
          )}
          style={{
            left: highlight.position.boundingRect.left,
            top: highlight.position.boundingRect.top,
            width: highlight.position.boundingRect.width,
            height: highlight.position.boundingRect.height,
          }}
        />
      ) : (
        <PdfHighlight
          key={highlight.id}
          position={highlight.position}
          comment={highlight.comment}
          isScrolledTo={isScrolledTo}
          onClick={() =>
            setTip(highlight, () => (
              <HighlightPreview highlight={highlight} onRemove={(id) => {
                removeHighlight(id);
                hideTip();
              }} />
            ))
          }
        />
      )
    ),
    [removeHighlight],
  );

  const handleSelectionFinished = useCallback(
    (
      position: ScaledPosition,
      content: Content,
      hideTipAndSelection: () => void,
    ) => {
      const text = content.text?.trim();
      if (!text) {
        hideTipAndSelection();
        return null;
      }

      return (
        <SelectionToolbar
          text={text}
          onAction={(action) => {
            handleSelectionAction(action, position, content);
            hideTipAndSelection();
          }}
        />
      );
    },
    [handleSelectionAction],
  );

  const handleScrollRef = useCallback(
    (scrollTo: (highlight: HighlightEntry) => void) => {
      scrollToRef.current = scrollTo;
    },
    [],
  );

  const handleScrollChange = useCallback(() => {
    // future hook for analytics or syncing scroll state
  }, []);

  return (
    <div className={clsx("relative h-full w-full overflow-hidden", className)}>
      <PdfLoader url={pdfUrl} beforeLoad={<Loader />}>
        {(pdfDocument) => (
          <PdfHighlighter
            pdfDocument={pdfDocument}
            highlights={activeHighlights}
            highlightTransform={renderHighlight}
            onSelectionFinished={handleSelectionFinished}
            onScrollChange={handleScrollChange}
            scrollRef={handleScrollRef}
            pdfScaleValue="page-width"
            enableAreaSelection={() => false}
          />
        )}
      </PdfLoader>
    </div>
  );
});

PdfViewerWithHighlights.displayName = "PdfViewerWithHighlights";

const Loader = () => (
  <div className="flex h-full w-full items-center justify-center bg-zinc-50 text-sm text-zinc-500">
    Loading PDF…
  </div>
);

export default PdfViewerWithHighlights;
