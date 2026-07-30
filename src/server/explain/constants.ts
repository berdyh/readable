import type { ConceptSignalType } from "@/server/db";

/**
 * Ledger signal weights. Seen ≠ known: a summary exposure is weak
 * evidence, an explained selection a bit stronger, an explicit "I know
 * this" confirmation strong. Asking about a concept in QA is an
 * *interest* signal and carries ~zero knowledge weight by design.
 */
export const SIGNAL_WEIGHTS: Record<ConceptSignalType, number> = {
  summary_exposure: 1,
  selection_explained: 2,
  qa_asked: 0,
  explicit_confirmed: 5,
};

/** Decayed weighted score at or above this counts as "known". */
export const MASTERY_THRESHOLD = 3;

/** Half-life, in days, of the exponential time decay applied at read. */
export const DECAY_HALF_LIFE_DAYS = 60;

/**
 * Citation-router trigger thresholds ("obscure or recent work"):
 * retrieval fires when a cited paper has fewer citations than this…
 */
export const OBSCURE_CITATION_COUNT_THRESHOLD = 200;

/** …or was published in/after this year (post-training-cutoff risk). */
export const RECENT_YEAR_CUTOFF = 2025;

/**
 * Cap on low-familiarity glossary terms grounded by the single bounded
 * second-pass call (batched per response, never per item).
 */
export const MAX_GROUNDING_TERMS_PER_RESPONSE = 5;

/** Domain facet used when no domain can be inferred for a concept key. */
export const DEFAULT_CONCEPT_DOMAIN = "general";
