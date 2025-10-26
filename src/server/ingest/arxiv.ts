import { XMLParser } from 'fast-xml-parser';

import { buildAr5ivHtmlUrl, buildArxivMetadataUrl, buildArxivPdfUrl, getIngestEnvironment, type IngestEnvironmentConfig } from './config';
import type { ArxivMetadata } from './types';
import { ensureArray, fetchBufferWithTimeout, fetchTextWithTimeout, normalizeWhitespace } from './utils';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
});

function parseArxivAuthors(entry: Record<string, unknown>): string[] {
  const authors = ensureArray(entry.author as Record<string, unknown>);
  return authors
    .map((author) => {
      if (typeof author === 'string') {
        return normalizeWhitespace(author);
      }
      if (
        author &&
        typeof author === 'object' &&
        'name' in author &&
        typeof (author as { name?: string }).name === 'string'
      ) {
        return normalizeWhitespace((author as { name: string }).name);
      }
      return undefined;
    })
    .filter((name): name is string => Boolean(name));
}

function parseArxivCategories(entry: Record<string, unknown>): string[] {
  const primary =
    entry.primary_category &&
    typeof entry.primary_category === 'object' &&
    entry.primary_category !== null &&
    '@_term' in entry.primary_category &&
    typeof (entry.primary_category as { '@_term'?: string })['@_term'] ===
      'string'
      ? (entry.primary_category as { '@_term': string })['@_term']
      : undefined;

  const categories = ensureArray(entry.category as Record<string, unknown>)
    .map((category) => {
      if (
        category &&
        typeof category === 'object' &&
        '@_term' in category &&
        typeof (category as { '@_term'?: string })['@_term'] === 'string'
      ) {
        return (category as { '@_term': string })['@_term'];
      }
      return undefined;
    })
    .filter((value): value is string => Boolean(value));

  const merged = [primary, ...categories].filter(
    (value): value is string => Boolean(value),
  );

  return Array.from(new Set(merged));
}

function parseArxivLinks(entry: Record<string, unknown>): {
  pdfUrl?: string;
} {
  const links = ensureArray(entry.link as Record<string, unknown>);
  let pdfUrl: string | undefined;

  for (const link of links) {
    if (
      link &&
      typeof link === 'object' &&
      '@_title' in link &&
      typeof (link as { '@_title'?: string })['@_title'] === 'string' &&
      (link as { '@_title': string })['@_title'] === 'pdf' &&
      '@_href' in link &&
      typeof (link as { '@_href'?: string })['@_href'] === 'string'
    ) {
      pdfUrl = (link as { '@_href': string })['@_href'];
      break;
    }
  }

  return { pdfUrl };
}

export async function fetchArxivMetadata(
  arxivId: string,
  contactEmail?: string,
  environment: IngestEnvironmentConfig = getIngestEnvironment(),
): Promise<ArxivMetadata | undefined> {
  const url = buildArxivMetadataUrl(arxivId, contactEmail, environment);
  const xml = await fetchTextWithTimeout(
    url,
    environment.fetchTimeoutMs,
    contactEmail
      ? {
          headers: {
            'User-Agent': `ReadableIngest/1.0 (+mailto:${contactEmail})`,
          },
        }
      : undefined,
  );

  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const feed = parsed.feed as Record<string, unknown> | undefined;
  if (!feed) {
    return undefined;
  }

  const entry = ensureArray<Record<string, unknown>>(
    feed.entry as Record<string, unknown> | Record<string, unknown>[] | undefined,
  )[0];
  if (!entry) {
    return undefined;
  }

  const id =
    typeof entry.id === 'string'
      ? entry.id.split('/abs/').pop() ?? entry.id
      : arxivId;

  const { pdfUrl } = parseArxivLinks(entry);

  const categories = parseArxivCategories(entry);

  return {
    id,
    title:
      typeof entry.title === 'string'
        ? normalizeWhitespace(entry.title)
        : undefined,
    abstract:
      typeof entry.summary === 'string'
        ? normalizeWhitespace(entry.summary)
        : undefined,
    publishedAt:
      typeof entry.published === 'string'
        ? new Date(entry.published).toISOString()
        : undefined,
    updatedAt:
      typeof entry.updated === 'string'
        ? new Date(entry.updated).toISOString()
        : undefined,
    authors: parseArxivAuthors(entry),
    pdfUrl: pdfUrl ?? buildArxivPdfUrl(arxivId),
    primaryCategory: categories[0],
    categories,
  };
}

export async function fetchAr5ivHtml(
  arxivId: string,
  environment: IngestEnvironmentConfig = getIngestEnvironment(),
): Promise<string> {
  const url = buildAr5ivHtmlUrl(arxivId, environment);
  return fetchTextWithTimeout(url, environment.fetchTimeoutMs);
}

export async function fetchArxivPdf(
  arxivId: string,
  environment: IngestEnvironmentConfig = getIngestEnvironment(),
  contactEmail?: string,
): Promise<ArrayBuffer> {
  const pdfUrl = buildArxivPdfUrl(arxivId);
  return fetchBufferWithTimeout(pdfUrl, environment.pdfFetchTimeoutMs, {
    headers: {
      'User-Agent': `ReadableIngest/1.0${
        contactEmail ? ` (+mailto:${contactEmail})` : ''
      }`,
    },
  });
}
