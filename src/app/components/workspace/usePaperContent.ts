"use client";

import { useUser } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Block } from "../block-editor/types";
import { parseArxivHtmlToBlocks, parseSummaryToBlocks } from "../block-editor/parsers";
import type { InlineArxivIngestResult } from "@/server/editor/types";
import type { SummaryResult } from "@/server/summarize/types";
import type { ThreePass } from "./usePassState";

const DEFAULT_PDF_URL = "https://arxiv.org/pdf/1706.03762.pdf";
const DEFAULT_PAPER_ID = "arxiv:1706.03762";
const AUTH_REQUIRED_SUMMARY_MESSAGE = "Sign in to use personalized reading features.";

const normalizeArxivId = (paperId: string | undefined): string | undefined => {
  if (!paperId) {
    return undefined;
  }

  let normalized = paperId.startsWith("arxiv:") ? paperId.slice("arxiv:".length) : paperId;

  normalized = normalized.replace(/v\d+$/i, "");

  if (/^\d{4}\.\d{4,5}$/.test(normalized)) {
    return normalized;
  }

  return undefined;
};

const inferArxivPdfUrl = (paperId: string | undefined): string | undefined => {
  const normalized = normalizeArxivId(paperId);
  if (!normalized) {
    return undefined;
  }

  return `https://arxiv.org/pdf/${normalized}.pdf`;
};

const isSummaryResult = (value: unknown): value is SummaryResult => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    Array.isArray(record.sections) &&
    Array.isArray(record.key_findings) &&
    Array.isArray(record.figures)
  );
};

interface UsePaperContentOptions {
  paperId?: string;
  pdfUrl?: string;
  /**
   * Current three-pass reading stage. Pass 1 (skim) renders the
   * explanation contract as the primary reading blocks; passes 2–3 keep
   * the paper HTML primary. Defaults to "skim".
   */
  pass?: ThreePass;
}

/** The same paper-id defaulting usePaperContent applies, usable before it runs. */
export const resolvePaperId = (paperId: string | undefined): string =>
  paperId && paperId.trim() ? paperId : DEFAULT_PAPER_ID;

export const usePaperContent = ({ paperId, pdfUrl, pass = "skim" }: UsePaperContentOptions) => {
  const { isLoaded: isUserLoaded, isSignedIn } = useUser();
  const resolvedPaperId = resolvePaperId(paperId);
  const fallbackPdfUrl = inferArxivPdfUrl(resolvedPaperId);
  const resolvedPdfUrl = pdfUrl ?? fallbackPdfUrl ?? DEFAULT_PDF_URL;

  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [isSummaryLoading, setIsSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [arxivHtmlContent, setArxivHtmlContent] = useState<InlineArxivIngestResult | null>(null);
  const [isHtmlLoading, setIsHtmlLoading] = useState(false);
  const [htmlError, setHtmlError] = useState<string | null>(null);

  useEffect(() => {
    const arxivId = normalizeArxivId(resolvedPaperId);

    setArxivHtmlContent(null);
    setHtmlError(null);

    if (!arxivId) {
      setIsHtmlLoading(false);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const loadHtmlContent = async () => {
      setIsHtmlLoading(true);

      try {
        const response = await fetch("/api/editor/ingest/arxiv", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ target: arxivId }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          const message = payload?.error ?? `HTML fetch failed with status ${response.status}.`;
          throw new Error(message);
        }

        const result = (await response.json()) as InlineArxivIngestResult;

        if (isMounted) {
          setArxivHtmlContent(result);
        }
      } catch (caught) {
        if (!isMounted || controller.signal.aborted) {
          return;
        }

        console.warn("[ReaderWorkspace] HTML fetch failed, falling back to summary:", caught);
        setHtmlError(caught instanceof Error ? caught.message : "Failed to load HTML content.");
      } finally {
        if (isMounted) {
          setIsHtmlLoading(false);
        }
      }
    };

    void loadHtmlContent();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [resolvedPaperId]);

  useEffect(() => {
    if (isHtmlLoading || !isUserLoaded || !isSignedIn) {
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    const loadSummary = async () => {
      try {
        const response = await fetch("/api/summarize", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ paperId: resolvedPaperId }),
          signal: controller.signal,
        });

        const payload = (await response.json().catch(() => null)) as
          | SummaryResult
          | { error?: string }
          | null;

        if (!response.ok) {
          const message =
            payload &&
            typeof payload === "object" &&
            payload !== null &&
            "error" in payload &&
            typeof payload.error === "string"
              ? payload.error
              : `Summary request failed with status ${response.status}.`;
          throw new Error(message);
        }

        if (!isSummaryResult(payload)) {
          throw new Error("Summary response was malformed.");
        }

        if (isMounted) {
          setSummary(payload);
        }
      } catch (caught) {
        if (!isMounted || controller.signal.aborted) {
          return;
        }

        setSummaryError(
          caught instanceof Error ? caught.message : "Failed to load summary for this paper.",
        );
        setSummary(null);
      } finally {
        if (isMounted) {
          setIsSummaryLoading(false);
        }
      }
    };

    setSummary(null);
    setSummaryError(null);
    setIsSummaryLoading(true);
    void loadSummary();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [isHtmlLoading, isSignedIn, isUserLoaded, resolvedPaperId]);

  const authRequired = isUserLoaded && !isSignedIn;
  const effectiveSummary = authRequired ? null : summary;
  const effectiveSummaryError = authRequired ? AUTH_REQUIRED_SUMMARY_MESSAGE : summaryError;
  const effectiveIsSummaryLoading = isUserLoaded && isSignedIn ? isSummaryLoading : false;

  // Pass 1 (skim) puts the explanation contract first; the paper HTML
  // stays primary for passes 2–3 and as the fallback when no summary
  // exists yet.
  const summaryIsPrimary = pass === "skim" && Boolean(effectiveSummary);

  // Render-gated exposure recording (never for an unseen auto-generated
  // summary): fires once per paper, only when contract content is
  // actually the rendered surface and the reader is signed in.
  const exposureRecordedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!summaryIsPrimary || !isSignedIn) {
      return;
    }
    const concepts = effectiveSummary?.concepts?.filter((concept) => concept.concept) ?? [];
    if (concepts.length === 0) {
      return;
    }
    if (exposureRecordedFor.current === resolvedPaperId) {
      return;
    }
    exposureRecordedFor.current = resolvedPaperId;

    void fetch("/api/persona/exposure", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        paperId: resolvedPaperId,
        concepts: concepts.map((concept) => ({
          concept: concept.concept,
          domain: concept.domain,
          description: concept.description,
        })),
      }),
    }).catch(() => {
      // Best-effort: a missed exposure signal never disturbs reading.
    });
  }, [effectiveSummary, isSignedIn, resolvedPaperId, summaryIsPrimary]);

  // Blocks and the key naming the document they were parsed from, produced
  // together so they can never disagree. The editor remembers reader edits per
  // key: the parsers mint new block ids on every reparse, so without a key
  // saying "this is still the same document" a pass toggle looks like brand
  // new content and the edits are thrown away.
  const paperDocument = useMemo<{ blocks: Block[]; key: string }>(() => {
    const summaryKey = `${resolvedPaperId}:summary`;
    const paperKey = `${resolvedPaperId}:paper`;
    // Every placeholder shares one key, distinct from both real documents, so
    // that real content arriving always looks like a different document and
    // takes the clean-adopt path. A placeholder can never hold it hostage.
    const placeholderKey = `${resolvedPaperId}:placeholder`;

    if (summaryIsPrimary && effectiveSummary) {
      return { blocks: parseSummaryToBlocks(effectiveSummary), key: summaryKey };
    }

    if (arxivHtmlContent) {
      return { blocks: parseArxivHtmlToBlocks(arxivHtmlContent), key: paperKey };
    }

    if (isHtmlLoading) {
      return {
        blocks: [
          {
            id: "html-loading-placeholder",
            type: "paragraph",
            content: `Loading paper content for ${resolvedPaperId}…`,
            metadata: {},
          },
        ],
        key: placeholderKey,
      };
    }

    if (effectiveSummary) {
      return { blocks: parseSummaryToBlocks(effectiveSummary), key: summaryKey };
    }

    if (effectiveIsSummaryLoading) {
      return {
        blocks: [
          {
            id: "loading-placeholder",
            type: "paragraph",
            content: `Building a personalized summary for ${resolvedPaperId}…`,
            metadata: {},
          },
        ],
        key: placeholderKey,
      };
    }

    if (effectiveSummaryError && htmlError && !authRequired) {
      return {
        blocks: [
          {
            id: "error-placeholder",
            type: "paragraph",
            content: `Unable to load content: ${htmlError}. Trying summary pipeline...`,
            metadata: {},
          },
        ],
        key: placeholderKey,
      };
    }

    if (effectiveSummaryError) {
      return {
        blocks: [
          {
            id: "error-placeholder",
            type: "paragraph",
            content: `Summary unavailable: ${effectiveSummaryError}`,
            metadata: {},
          },
        ],
        key: placeholderKey,
      };
    }

    return {
      blocks: [
        {
          id: "pending-placeholder",
          type: "paragraph",
          content:
            "Waiting for the paper summary pipeline to finish processing. This usually takes a few moments after ingest completes.",
          metadata: {},
        },
      ],
      key: placeholderKey,
    };
  }, [
    arxivHtmlContent,
    authRequired,
    effectiveIsSummaryLoading,
    effectiveSummary,
    effectiveSummaryError,
    htmlError,
    isHtmlLoading,
    resolvedPaperId,
    summaryIsPrimary,
  ]);

  return {
    resolvedPaperId,
    resolvedPdfUrl,
    summary: effectiveSummary,
    summaryError: effectiveSummaryError,
    isSummaryLoading: effectiveIsSummaryLoading,
    arxivHtmlContent,
    isHtmlLoading,
    htmlError,
    initialBlocks: paperDocument.blocks,
    documentKey: paperDocument.key,
  };
};
