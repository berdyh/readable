import { createHash } from "node:crypto";

import type { PoolClient } from "pg";

import { buildCitationUuid, buildFigureUuid, buildPaperChunkUuid } from "./ids";
import { ensureSchema } from "./migrate";
import { withPgClient } from "./postgres";
import type { Citation, Figure, PaperChunk, PaperRecord } from "./types";

interface PaperChunkRow {
  id: string;
  paper_id: string;
  chunk_id: string;
  text: string;
  section: string | null;
  page_number: number | null;
  token_start: number | null;
  token_end: number | null;
  citations: string[] | null;
  figure_ids: string[] | null;
}

interface PaperFigureRow {
  id: string;
  paper_id: string;
  figure_id: string;
  caption: string;
  page_number: number | null;
  image_url: string | null;
  chunk_ids: string[] | null;
}

interface PaperCitationRow {
  id: string;
  paper_id: string;
  citation_id: string;
  title: string | null;
  authors: string[] | null;
  year: number | null;
  source: string | null;
  doi: string | null;
  url: string | null;
  chunk_ids: string[] | null;
}

/**
 * Natural-order comparison for chunk ids: "S2-p2" sorts before "S2-p10",
 * "S2" before "S10". Plain lexicographic ordering ("ORDER BY chunk_id")
 * silently shuffled the back half of every paper (S10 < S2), which is how
 * Training/Results/Conclusion sections vanished from summaries.
 */
function naturalCompareChunkIds(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

/**
 * Document-order comparator for paper chunks. `token_start` carries the
 * ingest-time reading-order ordinal; rows ingested before the ordinal
 * existed have NULL `token_start` permanently and fall back to
 * natural-sorting `chunk_id`.
 */
export function compareChunksByDocumentOrder(
  a: Pick<PaperChunk, "chunkId" | "tokenStart">,
  b: Pick<PaperChunk, "chunkId" | "tokenStart">,
): number {
  if (typeof a.tokenStart === "number" && typeof b.tokenStart === "number") {
    if (a.tokenStart !== b.tokenStart) {
      return a.tokenStart - b.tokenStart;
    }
  }
  return naturalCompareChunkIds(a.chunkId, b.chunkId);
}

const cleanArray = (values: string[] | undefined): string[] =>
  (values ?? []).map((value) => (typeof value === "string" ? value.trim() : "")).filter(Boolean);

const cleanIntArray = (values: string[] | undefined): string[] => cleanArray(values);

function mapPaperChunkRow(row: PaperChunkRow): PaperChunk {
  return {
    id: row.id,
    paperId: row.paper_id,
    chunkId: row.chunk_id,
    text: row.text,
    section: row.section ?? undefined,
    pageNumber: typeof row.page_number === "number" ? row.page_number : undefined,
    tokenStart: typeof row.token_start === "number" ? row.token_start : undefined,
    tokenEnd: typeof row.token_end === "number" ? row.token_end : undefined,
    citations: row.citations ?? undefined,
    figureIds: row.figure_ids ?? undefined,
  };
}

function mapFigureRow(row: PaperFigureRow): Figure {
  return {
    id: row.id,
    paperId: row.paper_id,
    figureId: row.figure_id,
    caption: row.caption ?? "",
    pageNumber: typeof row.page_number === "number" ? row.page_number : undefined,
    imageUrl: row.image_url ?? undefined,
    chunkIds: row.chunk_ids ?? undefined,
  };
}

function mapCitationRow(row: PaperCitationRow): Citation {
  return {
    id: row.id,
    paperId: row.paper_id,
    citationId: row.citation_id,
    title: row.title ?? undefined,
    authors: row.authors ?? undefined,
    year: typeof row.year === "number" ? row.year : undefined,
    source: row.source ?? undefined,
    doi: row.doi ?? undefined,
    url: row.url ?? undefined,
    chunkIds: row.chunk_ids ?? undefined,
  };
}

async function ensurePaperRow(
  client: PoolClient,
  paperId: string,
  record?: Partial<PaperRecord>,
): Promise<void> {
  await client.query(
    `
    INSERT INTO papers (
      paper_id,
      title,
      abstract,
      authors,
      primary_category,
      categories,
      published_at,
      updated_at,
      pdf_url,
      pages,
      refreshed_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    ON CONFLICT (paper_id) DO UPDATE SET
      title = COALESCE(EXCLUDED.title, papers.title),
      abstract = COALESCE(EXCLUDED.abstract, papers.abstract),
      authors = CASE
        WHEN array_length(EXCLUDED.authors, 1) IS NULL THEN papers.authors
        ELSE EXCLUDED.authors
      END,
      primary_category = COALESCE(EXCLUDED.primary_category, papers.primary_category),
      categories = CASE
        WHEN array_length(EXCLUDED.categories, 1) IS NULL THEN papers.categories
        ELSE EXCLUDED.categories
      END,
      published_at = COALESCE(EXCLUDED.published_at, papers.published_at),
      updated_at = COALESCE(EXCLUDED.updated_at, papers.updated_at),
      pdf_url = COALESCE(EXCLUDED.pdf_url, papers.pdf_url),
      pages = COALESCE(EXCLUDED.pages, papers.pages),
      refreshed_at = NOW()
    `,
    [
      paperId,
      record?.title ?? null,
      record?.abstract ?? null,
      cleanArray(record?.authors),
      record?.primaryCategory ?? null,
      cleanArray(record?.categories),
      record?.publishedAt ?? null,
      record?.updatedAt ?? null,
      record?.pdfUrl ?? null,
      typeof record?.pages === "number" ? record.pages : null,
    ],
  );
}

export async function upsertPaper(record: PaperRecord): Promise<void> {
  await ensureSchema();
  await withPgClient((client) => ensurePaperRow(client, record.paperId, record));
}

export async function getPaper(paperId: string): Promise<PaperRecord | undefined> {
  await ensureSchema();
  return withPgClient(async (client) => {
    const { rows } = await client.query<{
      paper_id: string;
      title: string | null;
      abstract: string | null;
      authors: string[] | null;
      primary_category: string | null;
      categories: string[] | null;
      published_at: Date | null;
      updated_at: Date | null;
      pdf_url: string | null;
      pages: number | null;
    }>(
      `SELECT paper_id, title, abstract, authors, primary_category, categories,
              published_at, updated_at, pdf_url, pages
       FROM papers
       WHERE paper_id = $1`,
      [paperId],
    );

    const [row] = rows;
    if (!row) {
      return undefined;
    }

    return {
      paperId: row.paper_id,
      title: row.title ?? undefined,
      abstract: row.abstract ?? undefined,
      authors: row.authors ?? [],
      primaryCategory: row.primary_category ?? undefined,
      categories: row.categories ?? [],
      publishedAt: row.published_at?.toISOString(),
      updatedAt: row.updated_at?.toISOString(),
      pdfUrl: row.pdf_url ?? undefined,
      pages: typeof row.pages === "number" ? row.pages : undefined,
    };
  });
}

export interface UpsertPaperChunksOptions {
  paperRecord?: Partial<PaperRecord>;
  replaceExistingForPaper?: boolean;
}

export interface UpsertPaperRelatedRecordsOptions {
  paperId?: string;
  replaceExistingForPaper?: boolean;
}

export interface ReplacePaperIngestDataInput {
  paper: PaperRecord;
  chunks: PaperChunk[];
  figures: Figure[];
  citations: Citation[];
}

export interface ReplacePaperIngestDataResult {
  chunkIds: string[];
  figureIds: string[];
  citationIds: string[];
}

export interface ReplacePaperIngestDataOptions {
  /**
   * Runs after the Postgres replacement transaction commits but before the
   * paper-scoped advisory lock is released. Vector replacement uses this to
   * keep same-paper DB and vector replacement serialized as one ingest unit.
   */
  afterCommit?: (result: ReplacePaperIngestDataResult) => Promise<void>;
}

function buildAdvisoryLockKeys(value: string): [number, number] {
  const digest = createHash("sha256").update(value).digest();
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

async function lockPaperIngest(client: PoolClient, paperId: string): Promise<void> {
  const [key1, key2] = buildAdvisoryLockKeys(`paper-ingest:${paperId}`);
  await client.query("SELECT pg_advisory_lock($1::integer, $2::integer)", [key1, key2]);
}

async function unlockPaperIngest(client: PoolClient, paperId: string): Promise<void> {
  const [key1, key2] = buildAdvisoryLockKeys(`paper-ingest:${paperId}`);
  await client.query("SELECT pg_advisory_unlock($1::integer, $2::integer)", [key1, key2]);
}

async function withPaperIngestLock<T>(
  client: PoolClient,
  paperId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await lockPaperIngest(client, paperId);
  try {
    return await fn();
  } finally {
    await unlockPaperIngest(client, paperId).catch(() => undefined);
  }
}

function assertPaperScopedRecords(
  paperId: string,
  records: Array<{ paperId: string }>,
  label: string,
): void {
  const mismatched = records.find((record) => record.paperId !== paperId);
  if (mismatched) {
    throw new Error(
      `${label} contains record for paper "${mismatched.paperId}" while replacing "${paperId}".`,
    );
  }
}

async function withTransaction<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

async function upsertPaperChunksWithClient(
  client: PoolClient,
  chunks: PaperChunk[],
  options: UpsertPaperChunksOptions = {},
): Promise<string[]> {
  const paperIds = Array.from(
    new Set([
      ...chunks.map((chunk) => chunk.paperId),
      ...(options.paperRecord?.paperId ? [options.paperRecord.paperId] : []),
    ]),
  );

  if (chunks.length === 0 && paperIds.length === 0) {
    return [];
  }

  for (const paperId of paperIds) {
    await ensurePaperRow(client, paperId, options.paperRecord);
  }

  if (options.replaceExistingForPaper) {
    for (const paperId of paperIds) {
      const chunkIds = chunks
        .filter((chunk) => chunk.paperId === paperId)
        .map((chunk) => chunk.chunkId);
      await client.query(
        `
          DELETE FROM paper_chunks
          WHERE paper_id = $1
            AND NOT (chunk_id = ANY($2::text[]))
          `,
        [paperId, chunkIds],
      );
    }
  }

  const ids: string[] = [];

  for (const chunk of chunks) {
    const id = chunk.id ?? buildPaperChunkUuid(chunk.paperId, chunk.chunkId);
    await client.query(
      `
        INSERT INTO paper_chunks (
          id,
          paper_id,
          chunk_id,
          text,
          section,
          page_number,
          token_start,
          token_end,
          citations,
          figure_ids
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (paper_id, chunk_id) DO UPDATE SET
          text = EXCLUDED.text,
          section = EXCLUDED.section,
          page_number = EXCLUDED.page_number,
          token_start = EXCLUDED.token_start,
          token_end = EXCLUDED.token_end,
          citations = EXCLUDED.citations,
          figure_ids = EXCLUDED.figure_ids
        `,
      [
        id,
        chunk.paperId,
        chunk.chunkId,
        chunk.text,
        chunk.section ?? null,
        typeof chunk.pageNumber === "number" ? chunk.pageNumber : null,
        typeof chunk.tokenStart === "number" ? chunk.tokenStart : null,
        typeof chunk.tokenEnd === "number" ? chunk.tokenEnd : null,
        cleanArray(chunk.citations),
        cleanArray(chunk.figureIds),
      ],
    );
    ids.push(id);
  }

  return ids;
}

export async function upsertPaperChunks(
  chunks: PaperChunk[],
  options: UpsertPaperChunksOptions = {},
): Promise<string[]> {
  if (chunks.length === 0) {
    return [];
  }
  await ensureSchema();
  return withPgClient((client) => upsertPaperChunksWithClient(client, chunks, options));
}

async function upsertFiguresWithClient(
  client: PoolClient,
  figures: Figure[],
  options: UpsertPaperRelatedRecordsOptions = {},
): Promise<string[]> {
  const paperIds = Array.from(
    new Set([
      ...figures.map((figure) => figure.paperId),
      ...(options.paperId ? [options.paperId] : []),
    ]),
  );

  if (figures.length === 0 && paperIds.length === 0) {
    return [];
  }

  for (const paperId of paperIds) {
    await ensurePaperRow(client, paperId);
  }

  if (options.replaceExistingForPaper) {
    for (const paperId of paperIds) {
      const figureIds = figures
        .filter((figure) => figure.paperId === paperId)
        .map((figure) => figure.figureId);
      await client.query(
        `
          DELETE FROM paper_figures
          WHERE paper_id = $1
            AND NOT (figure_id = ANY($2::text[]))
          `,
        [paperId, figureIds],
      );
    }
  }

  const ids: string[] = [];

  for (const figure of figures) {
    const id = figure.id ?? buildFigureUuid(figure.paperId, figure.figureId);
    await client.query(
      `
        INSERT INTO paper_figures (
          id,
          paper_id,
          figure_id,
          caption,
          page_number,
          image_url,
          chunk_ids
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (paper_id, figure_id) DO UPDATE SET
          caption = EXCLUDED.caption,
          page_number = EXCLUDED.page_number,
          image_url = EXCLUDED.image_url,
          chunk_ids = EXCLUDED.chunk_ids
        `,
      [
        id,
        figure.paperId,
        figure.figureId,
        figure.caption ?? "",
        typeof figure.pageNumber === "number" ? figure.pageNumber : null,
        figure.imageUrl ?? null,
        cleanIntArray(figure.chunkIds),
      ],
    );
    ids.push(id);
  }

  return ids;
}

export async function upsertFigures(
  figures: Figure[],
  options: UpsertPaperRelatedRecordsOptions = {},
): Promise<string[]> {
  if (figures.length === 0 && !options.paperId) {
    return [];
  }
  await ensureSchema();
  return withPgClient((client) => upsertFiguresWithClient(client, figures, options));
}

async function upsertCitationsWithClient(
  client: PoolClient,
  citations: Citation[],
  options: UpsertPaperRelatedRecordsOptions = {},
): Promise<string[]> {
  const paperIds = Array.from(
    new Set([
      ...citations.map((citation) => citation.paperId),
      ...(options.paperId ? [options.paperId] : []),
    ]),
  );

  if (citations.length === 0 && paperIds.length === 0) {
    return [];
  }

  for (const paperId of paperIds) {
    await ensurePaperRow(client, paperId);
  }

  if (options.replaceExistingForPaper) {
    for (const paperId of paperIds) {
      const citationIds = citations
        .filter((citation) => citation.paperId === paperId)
        .map((citation) => citation.citationId);
      await client.query(
        `
          DELETE FROM paper_citations
          WHERE paper_id = $1
            AND NOT (citation_id = ANY($2::text[]))
          `,
        [paperId, citationIds],
      );
    }
  }

  const ids: string[] = [];

  for (const citation of citations) {
    const id = citation.id ?? buildCitationUuid(citation.paperId, citation.citationId);

    await client.query(
      `
        INSERT INTO paper_citations (
          id,
          paper_id,
          citation_id,
          title,
          authors,
          year,
          source,
          doi,
          url,
          chunk_ids
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (paper_id, citation_id) DO UPDATE SET
          title = EXCLUDED.title,
          authors = EXCLUDED.authors,
          year = EXCLUDED.year,
          source = EXCLUDED.source,
          doi = EXCLUDED.doi,
          url = EXCLUDED.url,
          chunk_ids = EXCLUDED.chunk_ids
        `,
      [
        id,
        citation.paperId,
        citation.citationId,
        citation.title ?? null,
        cleanArray(citation.authors),
        typeof citation.year === "number" ? citation.year : null,
        citation.source ?? null,
        citation.doi ?? null,
        citation.url ?? null,
        cleanIntArray(citation.chunkIds),
      ],
    );
    ids.push(id);
  }

  return ids;
}

export async function upsertCitations(
  citations: Citation[],
  options: UpsertPaperRelatedRecordsOptions = {},
): Promise<string[]> {
  if (citations.length === 0 && !options.paperId) {
    return [];
  }
  await ensureSchema();
  return withPgClient((client) => upsertCitationsWithClient(client, citations, options));
}

export async function replacePaperIngestData(
  input: ReplacePaperIngestDataInput,
  options: ReplacePaperIngestDataOptions = {},
): Promise<ReplacePaperIngestDataResult> {
  await ensureSchema();

  const { paper, chunks, figures, citations } = input;
  assertPaperScopedRecords(paper.paperId, chunks, "chunks");
  assertPaperScopedRecords(paper.paperId, figures, "figures");
  assertPaperScopedRecords(paper.paperId, citations, "citations");

  return withPgClient((client) =>
    withPaperIngestLock(client, paper.paperId, async () => {
      const result = await withTransaction(client, async () => {
        await ensurePaperRow(client, paper.paperId, paper);

        const chunkIds = await upsertPaperChunksWithClient(client, chunks, {
          paperRecord: paper,
          replaceExistingForPaper: true,
        });
        const figureIds = await upsertFiguresWithClient(client, figures, {
          paperId: paper.paperId,
          replaceExistingForPaper: true,
        });
        const citationIds = await upsertCitationsWithClient(client, citations, {
          paperId: paper.paperId,
          replaceExistingForPaper: true,
        });

        return { chunkIds, figureIds, citationIds };
      });

      if (options.afterCommit) {
        await options.afterCommit(result);
      }

      return result;
    }),
  );
}

export async function fetchPaperChunksByPaperId(paperId: string): Promise<PaperChunk[]> {
  await ensureSchema();
  return withPgClient(async (client) => {
    const { rows } = await client.query<PaperChunkRow>(
      `SELECT id, paper_id, chunk_id, text, section, page_number,
              token_start, token_end, citations, figure_ids
       FROM paper_chunks
       WHERE paper_id = $1
       ORDER BY token_start ASC NULLS LAST, chunk_id ASC`,
      [paperId],
    );

    return rows.map(mapPaperChunkRow).sort(compareChunksByDocumentOrder);
  });
}

export async function fetchPaperFiguresByPaperId(paperId: string): Promise<Figure[]> {
  await ensureSchema();
  return withPgClient(async (client) => {
    const { rows } = await client.query<PaperFigureRow>(
      `SELECT id, paper_id, figure_id, caption, page_number, image_url, chunk_ids
       FROM paper_figures
       WHERE paper_id = $1
       ORDER BY figure_id ASC`,
      [paperId],
    );

    return rows.map(mapFigureRow);
  });
}

export async function fetchPaperCitationsByPaperId(paperId: string): Promise<Citation[]> {
  await ensureSchema();
  return withPgClient(async (client) => {
    const { rows } = await client.query<PaperCitationRow>(
      `SELECT id, paper_id, citation_id, title, authors, year, source, doi, url, chunk_ids
       FROM paper_citations
       WHERE paper_id = $1
       ORDER BY citation_id ASC`,
      [paperId],
    );

    return rows.map(mapCitationRow);
  });
}

export interface PaperChunkTextSearchHit {
  id: string;
  paperId: string;
  chunkId: string;
  text: string;
  section?: string;
  pageNumber?: number;
  citations: string[];
  figureIds: string[];
  rank: number;
}

export async function searchPaperChunksByText(
  paperId: string,
  query: string,
  limit = 10,
): Promise<PaperChunkTextSearchHit[]> {
  await ensureSchema();
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  return withPgClient(async (client) => {
    const { rows } = await client.query<{
      id: string;
      paper_id: string;
      chunk_id: string;
      text: string;
      section: string | null;
      page_number: number | null;
      citations: string[] | null;
      figure_ids: string[] | null;
      rank: number;
    }>(
      `SELECT id, paper_id, chunk_id, text, section, page_number,
              citations, figure_ids,
              ts_rank_cd(text_search, websearch_to_tsquery('english', $2)) AS rank
       FROM paper_chunks
       WHERE paper_id = $1
         AND text_search @@ websearch_to_tsquery('english', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      [paperId, trimmed, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      paperId: row.paper_id,
      chunkId: row.chunk_id,
      text: row.text,
      section: row.section ?? undefined,
      pageNumber: typeof row.page_number === "number" ? row.page_number : undefined,
      citations: row.citations ?? [],
      figureIds: row.figure_ids ?? [],
      rank: row.rank,
    }));
  });
}

export async function fetchChunksByIds(ids: string[]): Promise<PaperChunk[]> {
  if (ids.length === 0) {
    return [];
  }
  await ensureSchema();
  return withPgClient(async (client) => {
    const { rows } = await client.query<PaperChunkRow>(
      `SELECT id, paper_id, chunk_id, text, section, page_number,
              token_start, token_end, citations, figure_ids
       FROM paper_chunks
       WHERE id = ANY($1::uuid[])`,
      [ids],
    );

    return rows.map(mapPaperChunkRow);
  });
}

export async function fetchChunksByPageWindow(
  paperId: string,
  pages: number[],
): Promise<PaperChunk[]> {
  if (pages.length === 0) {
    return [];
  }
  await ensureSchema();
  return withPgClient(async (client) => {
    const { rows } = await client.query<PaperChunkRow>(
      `SELECT id, paper_id, chunk_id, text, section, page_number,
              token_start, token_end, citations, figure_ids
       FROM paper_chunks
       WHERE paper_id = $1 AND page_number = ANY($2::int[])
       ORDER BY page_number ASC, chunk_id ASC`,
      [paperId, pages],
    );

    return rows.map(mapPaperChunkRow);
  });
}
