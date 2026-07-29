import { fetchAr5ivHtml, fetchArxivMetadata } from "@/server/ingest";
import {
  buildAr5ivHtmlUrl,
  getIngestEnvironment,
  type IngestEnvironmentConfig,
} from "@/server/ingest";
import { parseAr5ivHtml } from "@/server/ingest";
import { fetchTextWithTimeout } from "@/server/ingest";

import type { InlineArxivIngestResult } from "./types";

const FALLBACK_HTML_SOURCES = ["html", "abs"];

interface InlineHtmlPayload {
  html: string;
  imageBaseUrl: string;
}

const ARXIV_INPUT_PATTERNS: RegExp[] = [
  /^arxiv[:\s]+(\d{4}\.\d{4,5}(?:v\d+)?)$/i,
  /^10\.48550\/arxiv\.(\d{4}\.\d{4,5}(?:v\d+)?)$/i,
  /^([a-z][a-z.-]*(?:\.[a-z]{2})?\/\d{7}(?:v\d+)?)$/i,
  /^(\d{4}\.\d{4,5}(?:v\d+)?)$/i,
];

const ARXIV_TARGET_ERROR_MESSAGE = "Enter an arXiv ID or arxiv.org/abs URL.";

export class InlineArxivIngestError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_target" | "timeout" | "rate_limit" | "not_found" | "upstream_failure",
  ) {
    super(message);
    this.name = "InlineArxivIngestError";
  }
}

function normalizeArxivId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutPdf = value.replace(/\.pdf$/i, "").trim();
  const withoutVersion = withoutPdf.replace(/v\d+$/i, "");
  return withoutVersion || undefined;
}

function extractArxivIdFromUrl(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return undefined;
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (hostname !== "arxiv.org") {
    return undefined;
  }

  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts[0]?.toLowerCase() !== "abs") {
    return undefined;
  }

  return normalizeArxivTarget(pathParts.slice(1).join("/"));
}

export function normalizeArxivTarget(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return extractArxivIdFromUrl(trimmed);
  }

  for (const pattern of ARXIV_INPUT_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match?.[1]) {
      const normalized = normalizeArxivId(match[1]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return undefined;
}

function classifyIngestFailure(error: unknown): InlineArxivIngestError["code"] | undefined {
  if (error instanceof InlineArxivIngestError) {
    return error.code;
  }

  const status =
    typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String((error as { name?: unknown }).name)
      : "";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const lowerMessage = message.toLowerCase();

  if (
    status === 429 ||
    lowerMessage.includes("status 429") ||
    lowerMessage.includes("rate limit")
  ) {
    return "rate_limit";
  }

  if (
    status === 408 ||
    status === 504 ||
    name === "AbortError" ||
    lowerMessage.includes("status 408") ||
    lowerMessage.includes("status 504") ||
    lowerMessage.includes("timed out") ||
    lowerMessage.includes("timeout")
  ) {
    return "timeout";
  }

  if (status === 404 || lowerMessage.includes("status 404")) {
    return "not_found";
  }

  return undefined;
}

function toInlineArxivIngestError(
  fallbackMessage: string,
  errors: unknown[],
): InlineArxivIngestError {
  const classifications = errors.map(classifyIngestFailure).filter(Boolean);
  const code = classifications.includes("rate_limit")
    ? "rate_limit"
    : classifications.includes("timeout")
      ? "timeout"
      : classifications.includes("not_found")
        ? "not_found"
        : "upstream_failure";

  return new InlineArxivIngestError(fallbackMessage, code);
}

async function fetchFallbackHtml(
  arxivId: string,
  environment: IngestEnvironmentConfig,
): Promise<InlineHtmlPayload | undefined> {
  const errors: unknown[] = [];

  for (const path of FALLBACK_HTML_SOURCES) {
    const url = `https://arxiv.org/${path}/${arxivId}`;
    try {
      const html = await fetchTextWithTimeout(url, environment.fetchTimeoutMs);
      if (html?.length) {
        return { html, imageBaseUrl: url };
      }
    } catch (error) {
      errors.push(error);
      console.warn(`[editor] Fallback HTML fetch failed for ${url}`, error);
    }
  }

  if (errors.length) {
    throw toInlineArxivIngestError(
      "Unable to fetch HTML representation for that arXiv ID.",
      errors,
    );
  }

  return undefined;
}

export async function ingestArxivInline(target: string): Promise<InlineArxivIngestResult> {
  const arxivId = normalizeArxivTarget(target);
  if (!arxivId) {
    throw new InlineArxivIngestError(ARXIV_TARGET_ERROR_MESSAGE, "invalid_target");
  }

  const environment = getIngestEnvironment();
  const [metadata, htmlPayload] = await Promise.all([
    fetchArxivMetadata(arxivId, environment.defaultContactEmail, environment),
    (async () => {
      try {
        return {
          html: await fetchAr5ivHtml(arxivId, environment),
          imageBaseUrl: buildAr5ivHtmlUrl(arxivId, environment),
        };
      } catch {
        return fetchFallbackHtml(arxivId, environment);
      }
    })(),
  ]);

  if (!htmlPayload) {
    throw new InlineArxivIngestError(
      "Unable to fetch HTML representation for that arXiv ID.",
      "not_found",
    );
  }

  const parsed = parseAr5ivHtml(htmlPayload.html, {
    imageBaseUrl: htmlPayload.imageBaseUrl,
  });

  if (!parsed.sections.length) {
    throw new Error("No structured sections were found in the fetched HTML content.");
  }

  return {
    arxivId: metadata?.id ?? arxivId,
    title: metadata?.title,
    authors: metadata?.authors,
    publishedAt: metadata?.publishedAt,
    categories: metadata?.categories,
    sections: parsed.sections.map((section) => ({
      id: section.id,
      title: section.title,
      level: section.level,
      paragraphs: section.paragraphs.map((paragraph) => paragraph.text),
    })),
    figures: parsed.figures.map((figure) => ({
      id: figure.id,
      label: figure.label,
      caption: figure.caption,
      imageUrl: figure.imageUrl,
    })),
    sourceUrl: `https://arxiv.org/abs/${arxivId}`,
  };
}
