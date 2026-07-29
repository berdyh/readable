/**
 * Character-safe truncation.
 *
 * `String.prototype.slice` counts UTF-16 code units, not characters. Any
 * character outside the Basic Multilingual Plane — mathematical italics, most
 * emoji — is stored as a surrogate *pair*, and slicing between the two halves
 * leaves a lone surrogate.
 *
 * A lone surrogate is not a real character. `JSON.stringify` emits it as a bare
 * `\ud835` escape, which is syntactically valid JSON but decodes to invalid
 * UTF-8, and Postgres rejects it outright in a text column.
 *
 * This is not hypothetical: arXiv papers are full of characters like `𝑁`
 * (U+1D441, MATHEMATICAL ITALIC CAPITAL N). Truncating the Attention Is All You
 * Need chunks mid-pair produced
 *
 *   Failed to parse the request body as JSON:
 *   messages[1].content: unexpected end of hex escape at line 1 column 12352
 *
 * from the upstream provider — an opaque 400 that looked like a model fault.
 */

/** True when the final code unit is an unpaired high surrogate. */
function endsWithLoneHighSurrogate(text: string): boolean {
  if (text.length === 0) return false;
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff;
}

/**
 * Truncates to at most `max` UTF-16 code units, never splitting a surrogate
 * pair. Returns the input unchanged when it already fits.
 */
export function truncateSafely(text: string, max: number): string {
  if (max <= 0) return "";
  if (text.length <= max) return text;

  let cut = text.slice(0, max);
  if (endsWithLoneHighSurrogate(cut)) {
    // Drop the orphaned half rather than keep an unpaired surrogate.
    cut = cut.slice(0, -1);
  }
  return cut;
}

/**
 * Truncates and appends an ellipsis, keeping the result within `max` code
 * units. Use for prompt text, where the ellipsis signals elision to the model.
 */
export function truncateWithEllipsis(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${truncateSafely(text, Math.max(0, max - 1))}…`;
}
