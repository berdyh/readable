/**
 * Public surface of the explain module — the mechanism library behind
 * the explanation flows. Summarize, QA, and selection each compose
 * these pieces under their OWN policy and voice; prompt text stays
 * per-task in llm-config. This module owns the shared mechanisms:
 * persona known/new split, source-label contract + validation, the
 * citation router, mastery derivation, concept keys, and rendering
 * primitives.
 */

export {
  SIGNAL_WEIGHTS,
  MASTERY_THRESHOLD,
  DECAY_HALF_LIFE_DAYS,
  OBSCURE_CITATION_COUNT_THRESHOLD,
  RECENT_YEAR_CUTOFF,
  MAX_GROUNDING_TERMS_PER_RESPONSE,
  DEFAULT_CONCEPT_DOMAIN,
  MAX_RENDERED_CONCEPT_NAME_LENGTH,
  MAX_CITATIONS_IN_SUMMARY_CONTEXT,
} from "./constants";

export {
  buildConceptKey,
  normalizeConceptName,
  normalizeDomain,
  splitConceptKey,
} from "./conceptKey";

export { deriveConceptMastery, decayFactor, scoreLedgerEntry } from "./mastery";
export type { ConceptMastery } from "./mastery";

export { loadPersonaSplit, renderPersonaBlock } from "./persona";
export type { PersonaSplit } from "./persona";

export {
  EXPLANATION_SOURCES,
  SOURCE_LABEL_SCHEMA,
  SOURCE_LABEL_INSTRUCTIONS,
  coerceSourceLabel,
  validateSourceLabel,
} from "./sourceLabels";
export type { ExplanationSource } from "./sourceLabels";

export {
  routeCitations,
  isSourceSpecificAsk,
  isObscureOrRecent,
  questionMentionsCitation,
  selectGroundingTerms,
} from "./citationRouter";
export type {
  CitationCandidate,
  CitationRouteDecision,
  CitationRouteReason,
  GlossaryTermFamiliarity,
  RouteCitationsInput,
} from "./citationRouter";

export {
  renderRoutedCitationContext,
  truncateForPrompt,
  CITATION_ABSTRACT_TRUNCATE,
} from "./render";

export { toCitationCandidate, loadIngestedIdsSafe } from "./citationCandidates";
