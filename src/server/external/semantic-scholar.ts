/**
 * Semantic Scholar Graph API client.
 *
 * Primary consumer is the ingest pipeline, which enriches the whole
 * bibliography in one `enrichCitationsBatch()` call (batch endpoint,
 * 500 ids/request) and persists the result to `paper_citations` — the
 * runtime explanation paths read Postgres only and never call this
 * module. Single lookups remain for future on-demand use. All lookups
 * are best-effort, never blocking.
 *
 * Rate limits (https://api.semanticscholar.org/api-docs/):
 *   - Unauthenticated: 100 requests / 5 min
 *   - With `SEMANTIC_SCHOLAR_KEY` (`x-api-key` header): 1000 requests / 5 min
 * 429 responses are retried once after honoring `Retry-After` (capped),
 * and identical lookups in flight are single-flighted.
 *
 * Caching: process-local Map keyed by lookup id. Entries are kept for
 * `CACHE_TTL_MS`. Adequate for warm Next.js workers; cold starts re-fetch.
 */

import { getTimeout, getUrl } from "@/server/config";

const CACHE_TTL_MS = 24 * 60 * 60_000; // 24h
const BATCH_LIMIT = 500;
const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_RETRY_AFTER_MS = 2_000;
const MAX_TITLE_LOOKUPS_PER_BATCH = 20;
const TITLE_LOOKUP_CONCURRENCY = 3;

const FIELDS = [
  "paperId",
  "title",
  "abstract",
  "year",
  "venue",
  "authors.name",
  "externalIds",
  "openAccessPdf",
  "citationCount",
  "url",
].join(",");

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

/** Identical lookups already in flight share one promise. */
const inFlight = new Map<string, Promise<SemanticScholarPaper | undefined>>();

function getBaseUrl(): string {
  return getUrl("semanticScholar", "SEMANTIC_SCHOLAR_API_URL").replace(/\/+$/, "");
}

function getTimeoutMs(): number {
  return getTimeout("semanticScholar", "SEMANTIC_SCHOLAR_TIMEOUT_MS");
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
    year: typeof raw.year === "number" ? raw.year : undefined,
    venue: raw.venue?.trim() || undefined,
    doi: raw.externalIds?.DOI?.trim() || undefined,
    arxivId: raw.externalIds?.ArXiv?.trim() || undefined,
    url: raw.url?.trim() || undefined,
    openAccessPdfUrl: raw.openAccessPdf?.url?.trim() || undefined,
    citationCount: typeof raw.citationCount === "number" ? raw.citationCount : undefined,
  };
}

function parseRetryAfterMs(header: string | null): number {
  if (!header) {
    return DEFAULT_RETRY_AFTER_MS;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return DEFAULT_RETRY_AFTER_MS;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function requestOnce<T>(
  path: string,
  init?: RequestInit,
): Promise<{ value?: T; retryAfterMs?: number }> {
  const apiKey = getApiKey();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (apiKey) {
    headers["x-api-key"] = apiKey;
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
      return {};
    }
    if (response.status === 429) {
      return { retryAfterMs: parseRetryAfterMs(response.headers.get("retry-after")) };
    }
    if (!response.ok) {
      // Don't throw — best-effort. Log and let caller use the
      // un-enriched citation.
      console.warn(`[semantic-scholar] ${path} returned ${response.status}`);
      return {};
    }
    return { value: (await response.json()) as T };
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") {
      console.warn(`[semantic-scholar] ${path} timed out after ${getTimeoutMs()}ms`);
    } else {
      console.warn(
        `[semantic-scholar] ${path} failed:`,
        error instanceof Error ? error.message : error,
      );
    }
    return {};
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shared across the lookups of one enrichment batch: once any request in
 * the batch has seen a 429, later 429s in the same batch give up
 * immediately instead of sleeping — otherwise a 50-reference bibliography
 * can stack Retry-After sleeps into minutes of user-facing ingest time.
 */
interface RateLimitState {
  rateLimited: boolean;
}

interface RequestOptions {
  rateLimitState?: RateLimitState;
}

async function request<T>(
  path: string,
  init?: RequestInit,
  options: RequestOptions = {},
): Promise<T | undefined> {
  const { rateLimitState } = options;
  const first = await requestOnce<T>(path, init);
  if (first.retryAfterMs === undefined) {
    return first.value;
  }

  if (rateLimitState?.rateLimited) {
    console.warn(`[semantic-scholar] ${path} rate limited; batch already saw a 429, giving up`);
    return undefined;
  }
  if (rateLimitState) {
    rateLimitState.rateLimited = true;
  }

  // Rate limited: honor Retry-After (capped) and retry exactly once.
  console.warn(`[semantic-scholar] ${path} rate limited; retrying in ${first.retryAfterMs}ms`);
  await sleep(first.retryAfterMs);
  const second = await requestOnce<T>(path, init);
  if (second.retryAfterMs !== undefined) {
    console.warn(`[semantic-scholar] ${path} still rate limited; giving up`);
    return undefined;
  }
  return second.value;
}

/**
 * Single-flight wrapper: concurrent identical lookups share one request.
 */
async function singleFlight(
  key: string,
  lookup: () => Promise<SemanticScholarPaper | undefined>,
): Promise<SemanticScholarPaper | undefined> {
  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = lookup().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
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

  return singleFlight(key, async () => {
    const raw = await request<RawSemanticScholarPaper>(
      `/paper/DOI:${encodeURIComponent(trimmed)}?fields=${FIELDS}`,
    );
    const shaped = shapePaper(raw);
    cacheSet(key, shaped ?? null);
    return shaped;
  });
}

/** Fetch by arXiv ID (e.g. `1706.03762`). */
export async function fetchByArxivId(arxivId: string): Promise<SemanticScholarPaper | undefined> {
  const trimmed = arxivId.trim();
  if (!trimmed) return undefined;
  const key = `arxiv:${trimmed.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached ?? undefined;

  return singleFlight(key, async () => {
    const raw = await request<RawSemanticScholarPaper>(
      `/paper/ARXIV:${encodeURIComponent(trimmed)}?fields=${FIELDS}`,
    );
    const shaped = shapePaper(raw);
    cacheSet(key, shaped ?? null);
    return shaped;
  });
}

/**
 * Search by title (and optional year hint). Returns the first hit, which
 * is reasonable for citation enrichment because SS ranks by relevance
 * and the citation already came from the paper's bibliography.
 */
export async function searchByTitle(
  title: string,
  year?: number,
  options: RequestOptions = {},
): Promise<SemanticScholarPaper | undefined> {
  const trimmed = title.trim();
  if (!trimmed) return undefined;
  const key = `title:${trimmed.toLowerCase()}:${year ?? ""}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached ?? undefined;

  return singleFlight(key, async () => {
    const params = new URLSearchParams({
      query: trimmed,
      limit: "3",
      fields: FIELDS,
    });
    if (year) {
      params.set("year", String(year));
    }
    const raw = await request<RawSearchResponse>(
      `/paper/search?${params.toString()}`,
      undefined,
      options,
    );
    const shaped = shapePaper(raw?.data?.[0]);
    cacheSet(key, shaped ?? null);
    return shaped;
  });
}

/**
 * Batch lookup via POST /paper/batch (up to 500 ids per call). Input ids
 * must already be prefixed S2 identifiers ("ARXIV:1706.03762",
 * "DOI:10.1000/xyz"). Returns a map keyed by the input id; misses are
 * absent. Best-effort — a failed chunk contributes nothing.
 */
export async function fetchPapersBatch(
  ids: string[],
  options: RequestOptions & { deadlineAt?: number } = {},
): Promise<Map<string, SemanticScholarPaper>> {
  const results = new Map<string, SemanticScholarPaper>();
  const cleaned = ids.map((id) => id.trim()).filter(Boolean);
  if (cleaned.length === 0) {
    return results;
  }

  for (let offset = 0; offset < cleaned.length; offset += BATCH_LIMIT) {
    if (options.deadlineAt !== undefined && Date.now() >= options.deadlineAt) {
      console.warn("[semantic-scholar] batch enrichment deadline reached; stopping early");
      break;
    }
    const chunk = cleaned.slice(offset, offset + BATCH_LIMIT);
    const raw = await request<Array<RawSemanticScholarPaper | null>>(
      `/paper/batch?fields=${FIELDS}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: chunk }),
      },
      options,
    );

    if (!Array.isArray(raw)) {
      continue;
    }

    raw.forEach((entry, index) => {
      const shaped = shapePaper(entry ?? undefined);
      const inputId = chunk[index];
      if (shaped && inputId) {
        results.set(inputId, shaped);
      }
    });
  }

  return results;
}

export interface CitationEnrichmentInput {
  /** Caller's correlation key (e.g. the citation_id). */
  key: string;
  arxivId?: string;
  doi?: string;
  title?: string;
  year?: number;
}

export interface EnrichCitationsBatchOptions {
  /**
   * Overall wall-clock budget in ms. When exceeded, remaining lookups
   * are skipped and whatever was enriched so far is returned — callers
   * store the rest unenriched (the next re-ingest retries).
   */
  deadlineMs?: number;
}

/** Simple worker pool: runs `worker` over `items` with bounded parallelism. */
async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      await worker(items[index]);
    }
  });
  await Promise.all(runners);
}

/**
 * Ingest-time bibliography enrichment. Citations with an arXiv id or DOI
 * go through the batch endpoint (500/call); title-only citations fall
 * back to bounded per-title search (first
 * `MAX_TITLE_LOOKUPS_PER_BATCH`, longest titles first — short strings
 * make bad search keys), run `TITLE_LOOKUP_CONCURRENCY` at a time.
 * Returns a map keyed by the caller's `key`. Within one call, the first
 * 429 disables further retry sleeps, and `options.deadlineMs` bounds the
 * whole operation.
 */
export async function enrichCitationsBatch(
  inputs: CitationEnrichmentInput[],
  options: EnrichCitationsBatchOptions = {},
): Promise<Map<string, SemanticScholarPaper>> {
  const results = new Map<string, SemanticScholarPaper>();
  const rateLimitState: RateLimitState = { rateLimited: false };
  const deadlineAt = options.deadlineMs !== undefined ? Date.now() + options.deadlineMs : undefined;
  const pastDeadline = (): boolean => deadlineAt !== undefined && Date.now() >= deadlineAt;

  const batchIds: string[] = [];
  const batchKeyById = new Map<string, string>();
  const titleOnly: CitationEnrichmentInput[] = [];

  for (const input of inputs) {
    const arxivId = input.arxivId?.trim();
    const doi = input.doi?.trim();
    if (arxivId) {
      const id = `ARXIV:${arxivId}`;
      batchIds.push(id);
      batchKeyById.set(id, input.key);
    } else if (doi) {
      const id = `DOI:${doi}`;
      batchIds.push(id);
      batchKeyById.set(id, input.key);
    } else if (input.title && input.title.trim().length >= 12) {
      titleOnly.push(input);
    }
  }

  const batchResults = await fetchPapersBatch(batchIds, { rateLimitState, deadlineAt });
  for (const [id, paper] of batchResults) {
    const key = batchKeyById.get(id);
    if (key) {
      results.set(key, paper);
    }
  }

  const titleCandidates = titleOnly
    .slice()
    .sort((a, b) => (b.title?.length ?? 0) - (a.title?.length ?? 0))
    .slice(0, MAX_TITLE_LOOKUPS_PER_BATCH);

  await runWithConcurrency(titleCandidates, TITLE_LOOKUP_CONCURRENCY, async (input) => {
    if (pastDeadline()) {
      return;
    }
    const paper = await searchByTitle(input.title ?? "", input.year, { rateLimitState });
    if (paper) {
      results.set(input.key, paper);
    }
  });

  return results;
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

/** Test-only — clears the in-process cache and in-flight registry. */
export function _resetCacheForTests(): void {
  cache.clear();
  inFlight.clear();
}
