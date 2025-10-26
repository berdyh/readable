import { fetchAr5ivHtml, fetchArxivMetadata } from '@/server/ingest/arxiv';
import {
  getIngestEnvironment,
  type IngestEnvironmentConfig,
} from '@/server/ingest/config';
import { parseAr5ivHtml } from '@/server/ingest/ar5iv';
import { fetchTextWithTimeout } from '@/server/ingest/utils';

import type { InlineArxivIngestResult } from './types';

const FALLBACK_HTML_SOURCES = ['html', 'abs'];

function resolveImageBase(ar5ivBaseUrl: string): string | undefined {
  try {
    return new URL(ar5ivBaseUrl).origin;
  } catch {
    return undefined;
  }
}

const ARXIV_INPUT_PATTERNS: RegExp[] = [
  /arxiv[:\s]+(\d{4}\.\d{4,5}(?:v\d+)?)/i,
  /arxiv\.org\/(?:abs|pdf)\/([\w\-\.\/]+?)(?:v\d+)?(?:\.pdf)?(?:[#?].*)?$/i,
  /10\.48550\/arXiv\.(\d{4}\.\d{4,5}(?:v\d+)?)/i,
  /10\.48550\/ARXIV\.(\d{4}\.\d{4,5}(?:v\d+)?)/i,
  /\b(\w+\/\d{7})(?:v\d+)?\b/i,
  /\b(\d{4}\.\d{4,5})(?:v\d+)?\b/,
];

function normalizeArxivId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const withoutPdf = value.replace(/\.pdf$/i, '').trim();
  const withoutVersion = withoutPdf.replace(/v\d+$/i, '');
  return withoutVersion || undefined;
}

function extractArxivId(input: string): string | undefined {
  for (const pattern of ARXIV_INPUT_PATTERNS) {
    const match = input.match(pattern);
    if (match?.[1]) {
      const normalized = normalizeArxivId(match[1]);
      if (normalized) {
        return normalized;
      }
    }
  }
  return normalizeArxivId(input);
}

async function fetchFallbackHtml(
  arxivId: string,
  environment: IngestEnvironmentConfig,
): Promise<string | undefined> {
  for (const path of FALLBACK_HTML_SOURCES) {
    const url = `https://arxiv.org/${path}/${arxivId}`;
    try {
      const html = await fetchTextWithTimeout(url, environment.fetchTimeoutMs);
      if (html?.length) {
        return html;
      }
    } catch (error) {
      console.warn(`[editor] Fallback HTML fetch failed for ${url}`, error);
    }
  }
  return undefined;
}

export async function ingestArxivInline(
  target: string,
): Promise<InlineArxivIngestResult> {
  const arxivId = extractArxivId(target);
  if (!arxivId) {
    throw new Error('Unable to determine arXiv identifier from input.');
  }

  const environment = getIngestEnvironment();
  const [metadata, html] = await Promise.all([
    fetchArxivMetadata(arxivId, environment.defaultContactEmail, environment),
    (async () => {
      try {
        return await fetchAr5ivHtml(arxivId, environment);
      } catch {
        return fetchFallbackHtml(arxivId, environment);
      }
    })(),
  ]);

  if (!html) {
    throw new Error('Unable to fetch HTML representation for that arXiv ID.');
  }

  const imageBase = resolveImageBase(environment.ar5ivBaseUrl);
  const parsed = parseAr5ivHtml(html, { imageBaseUrl: imageBase });

  if (!parsed.sections.length) {
    throw new Error(
      'No structured sections were found in the fetched HTML content.',
    );
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
