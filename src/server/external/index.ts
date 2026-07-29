/**
 * Public surface of the external module.
 *
 * Only citation enrichment is public. The per-lookup cache and the individual
 * DOI/arXiv/title lookups behind `enrichCitation()` are internal.
 */
export { enrichCitation } from "./semantic-scholar";
export type { SemanticScholarPaper } from "./semantic-scholar";
