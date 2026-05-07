/**
 * Semantic Scholar Graph API client.
 *
 * Used by the QA path to enrich `paper_citations` rows with metadata
 * (abstract, year, authors, venue, openAccessPdf URL, externalIds)
 * when the citation came from the LLM with sparse fields. Falls back
 * silently on errors — Semantic Scholar is best-effort, never blocking.
 *
 * Rate limits (https://api.semanticscholar.org/api-docs/):
 *   - Unauthenticated: 100 requests / 5 min
 *   - With `SEMANTIC_SCHOLAR_KEY` (`x-api-key` header): 1000 requests / 5 min
 *
 * Caching: process-local Map keyed by lookup id. Entries are kept for
 * `CACHE_TTL_MS`. Adequate for warm Next.js workers; cold starts re-fetch.
 */

const DEFAULT_BASE_URL = 'https://api.semanticscholar.org/graph/v1';
const DEFAULT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 24 * 60 * 60_000; // 24h

const FIELDS = [
  'paperId',
  'title',
  'abstract',
  'year',
  'venue',
  'authors.name',
  'externalIds',
  'openAccessPdf',
  'citationCount',
  'url',
].join(',');

export interface SemanticScholarPaper {
  /** SS-internal id (UUID-like). */
  paperId: string;
  title?: string;
  abstract?: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  arxivId?: string;
  url?: string;
  openAccessPdfUrl?: string;
  citationCount?: number;
}

interface RawAuthor {
  name?: string;
}

interface RawExternalIds {
  DOI?: string;
  ArXiv?: string;
  PubMed?: string;
  CorpusId?: number;
}

interface RawSemanticScholarPaper {
  paperId?: string;
  title?: string;
  abstract?: string | null;
  year?: number | null;
  venue?: string | null;
  authors?: RawAuthor[];
  externalIds?: RawExternalIds;
  openAccessPdf?: { url?: string } | null;
  citationCount?: number;
  url?: string;
}

interface RawSearchResponse {
  data?: RawSemanticScholarPaper[];
}

interface CacheEntry {
  value: SemanticScholarPaper | null;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();

function getBaseUrl(): string {
  return (process.env.SEMANTIC_SCHOLAR_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function getTimeoutMs(): number {
  const raw = process.env.SEMANTIC_SCHOLAR_TIMEOUT_MS;
  return raw && Number.isFinite(Number(raw)) ? Number(raw) : DEFAULT_TIMEOUT_MS;
}

function getApiKey(): string | undefined {
  const raw = process.env.SEMANTIC_SCHOLAR_KEY?.trim();
  return raw && raw.length > 0 ? raw : undefined;
}

function shapePaper(raw: RawSemanticScholarPaper | undefined): SemanticScholarPaper | undefined {
  if (!raw?.paperId) return undefined;
  const authors = (raw.authors ?? [])
    .map((a) => a?.name?.trim())
    .filter((name): name is string => Boolean(name && name.length > 0));
  return {
    paperId: raw.paperId,
    title: raw.title?.trim() || undefined,
    abstract: raw.abstract?.trim() || undefined,
    authors: authors.length > 0 ? authors : undefined,
    year: typeof raw.year === 'number' ? raw.year : undefined,
    venue: raw.venue?.trim() || undefined,
    doi: raw.externalIds?.DOI?.trim() || undefined,
    arxivId: raw.externalIds?.ArXiv?.trim() || undefined,
    url: raw.url?.trim() || undefined,
    openAccessPdfUrl: raw.openAccessPdf?.url?.trim() || undefined,
    citationCount: typeof raw.citationCount === 'number' ? raw.citationCount : undefined,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T | undefined> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), getTimeoutMs());

  try {
    const response = await fetch(`${getBaseUrl()}${path}`, {
      ...init,
      headers,
      signal: controller.signal,
    });
    if (response.status === 404) {
      return undefined;
    }
    if (!response.ok) {
      // Don't throw — best-effort. Log and let caller use the
      // un-enriched citation.
      console.warn(`[semantic-scholar] ${path} returned ${response.status}`);
      return undefined;
    }
    return (await response.json()) as T;
  } catch (error) {
    if ((error as { name?: string }).name === 'AbortError') {
      console.warn(`[semantic-scholar] ${path} timed out after ${getTimeoutMs()}ms`);
    } else {
      console.warn(
        `[semantic-scholar] ${path} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function cacheGet(key: string): SemanticScholarPaper | null | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet(key: string, value: SemanticScholarPaper | null): void {
  cache.set(key, { value, fetchedAt: Date.now() });
}

/** Fetch paper metadata by DOI. Returns undefined when unknown / failed. */
export async function fetchByDoi(doi: string): Promise<SemanticScholarPaper | undefined> {
  const trimmed = doi.trim();
  if (!trimmed) return undefined;
  const key = `doi:${trimmed.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached ?? undefined;

  const raw = await request<RawSemanticScholarPaper>(
    `/paper/DOI:${encodeURIComponent(trimmed)}?fields=${FIELDS}`,
  );
  const shaped = shapePaper(raw);
  cacheSet(key, shaped ?? null);
  return shaped;
}

/** Fetch by arXiv ID (e.g. `1706.03762`). */
export async function fetchByArxivId(arxivId: string): Promise<SemanticScholarPaper | undefined> {
  const trimmed = arxivId.trim();
  if (!trimmed) return undefined;
  const key = `arxiv:${trimmed.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached ?? undefined;

  const raw = await request<RawSemanticScholarPaper>(
    `/paper/ARXIV:${encodeURIComponent(trimmed)}?fields=${FIELDS}`,
  );
  const shaped = shapePaper(raw);
  cacheSet(key, shaped ?? null);
  return shaped;
}

/**
 * Search by title (and optional year hint). Returns the first hit, which
 * is reasonable for citation enrichment because SS ranks by relevance
 * and the citation already came from the paper's bibliography.
 */
export async function searchByTitle(
  title: string,
  year?: number,
): Promise<SemanticScholarPaper | undefined> {
  const trimmed = title.trim();
  if (!trimmed) return undefined;
  const key = `title:${trimmed.toLowerCase()}:${year ?? ''}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached ?? undefined;

  const params = new URLSearchParams({
    query: trimmed,
    limit: '3',
    fields: FIELDS,
  });
  if (year) {
    params.set('year', String(year));
  }
  const raw = await request<RawSearchResponse>(
    `/paper/search?${params.toString()}`,
  );
  const shaped = shapePaper(raw?.data?.[0]);
  cacheSet(key, shaped ?? null);
  return shaped;
}

/**
 * Best-effort lookup that picks the most reliable available identifier:
 *   1. arxivId
 *   2. doi
 *   3. title (only if year is also present, to reduce false matches)
 */
export async function enrichCitation(input: {
  arxivId?: string;
  doi?: string;
  title?: string;
  year?: number;
}): Promise<SemanticScholarPaper | undefined> {
  if (input.arxivId) {
    const result = await fetchByArxivId(input.arxivId);
    if (result) return result;
  }
  if (input.doi) {
    const result = await fetchByDoi(input.doi);
    if (result) return result;
  }
  if (input.title && input.title.length >= 12) {
    return searchByTitle(input.title, input.year);
  }
  return undefined;
}

/** Test-only — clears the in-process cache. */
export function _resetCacheForTests(): void {
  cache.clear();
}
