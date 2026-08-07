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

/**
 * …or was published in/after this year.
 *
 * A hand-maintained heuristic for "new enough that the model may not
 * know it" — deliberately NOT a claim about any model's training
 * cutoff. Nothing here can know which model answers: `routeCitations`
 * runs while the prompt is being assembled, and the provider/model is
 * resolved afterwards inside `llm/router.ts`, where
 * `LLM_ALLOWED_PROVIDERS` failover can cross providers mid-call and env
 * overrides can name models that have no entry in `llm-config`.
 *
 * Left alone, this literal widens the trigger every January: the span
 * it calls "recent" grows by a year while the value stands still, so
 * more citations pull retrieval on a path nobody watches. It is pinned
 * to the calendar by `RECENT_YEAR_CUTOFF_MAX_LAG_YEARS` and the test in
 * `explain.test.ts` that enforces it. When that test fails, the fix is
 * to re-decide this value — not to widen the band.
 */
export const RECENT_YEAR_CUTOFF = 2025;

/**
 * How far behind the real current year `RECENT_YEAR_CUTOFF` is allowed
 * to sit. 1 means: re-decide the cutoff once a year, which is the rate
 * at which "recent" itself moves. The cutoff may also equal the current
 * year, but never exceed it — a future cutoff would silently disable
 * the recency half of the trigger altogether.
 *
 * Enforced only by the test; nothing in the request path reads the
 * clock, so routing stays deterministic.
 */
export const RECENT_YEAR_CUTOFF_MAX_LAG_YEARS = 1;

/**
 * Cap on low-familiarity glossary terms grounded by the single bounded
 * second-pass call (batched per response, never per item).
 */
export const MAX_GROUNDING_TERMS_PER_RESPONSE = 5;

/** Domain facet used when no domain can be inferred for a concept key. */
export const DEFAULT_CONCEPT_DOMAIN = "general";

/**
 * Defensive cap on concept names rendered into prompts. The recorder
 * bounds names at write time; this guards rows persisted before that
 * bound existed (or written by any other path).
 */
export const MAX_RENDERED_CONCEPT_NAME_LENGTH = 80;

/**
 * Cap on routed citations rendered into the summarize prompt. Without a
 * bound, a 50-reference paper of obscure/recent work dumps tens of KB
 * of abstracts into every summary call.
 */
export const MAX_CITATIONS_IN_SUMMARY_CONTEXT = 6;
