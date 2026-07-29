/**
 * Public surface of the editor module.
 *
 * Two groups: the selection-scoped actions the `/api/editor/selection/*` routes
 * expose, and the inline arXiv ingest the editor's `/arxiv` slash command uses.
 */
export {
  getSelectionCitations,
  getSelectionFigures,
  summarizeSelection,
} from "./selection";

export { InlineArxivIngestError, ingestArxivInline, normalizeArxivTarget } from "./ingest";

export type * from "./types";
