/**
 * Public surface of the ingest module.
 *
 * Two groups, because two kinds of caller exist:
 *
 * 1. `ingestPaper()` — the whole arXiv → stored-records pipeline. This is what
 *    `/api/ingest` and `/api/editor/ingest/arxiv` use, and what new callers
 *    should reach for.
 * 2. The extraction primitives below it. These are exposed because
 *    `/api/extract-research-paper` and the summarize/qa context builders need
 *    to fetch or parse a source without writing anything to Postgres or Qdrant.
 *    See the `ingest.extraction-primitives-are-public` stub in the manifest —
 *    the route reimplements part of the pipeline rather than calling into it.
 */
export type {
  IngestRequest,
  IngestResult,
  PaperSection,
  PaperReference,
  PaperFigure,
} from './types';

export { ingestPaper } from './pipeline';

// --- extraction primitives (see note above) ---
export { fetchAr5ivHtml, fetchArxivMetadata } from './arxiv';
export { parseAr5ivHtml } from './ar5iv';
export { extractPdfText, shouldUseOcr } from './pdf';
export { runDeepSeekOcr } from './ocr';
export { fetchTextWithTimeout } from './utils';
export {
  buildAr5ivHtmlUrl,
  getIngestEnvironment,
  type IngestEnvironmentConfig,
} from './config';
