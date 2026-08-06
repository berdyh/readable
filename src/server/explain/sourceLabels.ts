/**
 * Source-label contract. Every explanation item carries a `source`
 * telling the reader whether it came from the model's own knowledge
 * (under the pedagogy prompt) or from retrieved cited text. The label is
 * server-validated: a model may only claim `cited_text` when the router
 * actually supplied retrieved passages for that item — otherwise the
 * label is downgraded, mirroring QA's existing citation-validation
 * pattern.
 */

export type ExplanationSource = "model_knowledge" | "cited_text";

export const EXPLANATION_SOURCES: readonly ExplanationSource[] = ["model_knowledge", "cited_text"];

/** JSON-schema fragment for a `source` field. Spread into item schemas. */
export const SOURCE_LABEL_SCHEMA: Record<string, unknown> = {
  type: "string",
  enum: [...EXPLANATION_SOURCES],
  description:
    'Where this content came from: "cited_text" ONLY when it is grounded in the retrieved cited passages supplied in the prompt; otherwise "model_knowledge".',
};

/** Prompt instructions that accompany the schema fragment. */
export const SOURCE_LABEL_INSTRUCTIONS =
  'Label every item with its source: use "cited_text" only when the content is grounded in retrieved cited passages provided in this prompt; use "model_knowledge" for everything you explain from your own understanding. Never claim "cited_text" without supplied passages.';

export function coerceSourceLabel(value: unknown): ExplanationSource {
  return value === "cited_text" ? "cited_text" : "model_knowledge";
}

/**
 * Server-side validation: `cited_text` survives only when retrieved
 * passages were actually supplied for the item.
 */
export function validateSourceLabel(
  requested: unknown,
  hasRetrievedEvidence: boolean,
): ExplanationSource {
  const label = coerceSourceLabel(requested);
  if (label === "cited_text" && !hasRetrievedEvidence) {
    return "model_knowledge";
  }
  return label;
}
