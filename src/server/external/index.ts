/**
 * Public surface of the external module.
 *
 * Only citation enrichment is public: `enrichCitationsBatch()` for the
 * ingest pipeline (batch endpoint + bounded title fallback) and
 * `enrichCitation()` for single lookups. The per-lookup cache and the
 * individual DOI/arXiv/title lookups are internal.
 */
export { enrichCitation, enrichCitationsBatch } from "./semantic-scholar";
export type { CitationEnrichmentInput, SemanticScholarPaper } from "./semantic-scholar";
