import { fetchConceptLedgerForUser } from "@/server/db";

import { deriveConceptMastery, type ConceptMastery } from "./mastery";
import { splitConceptKey } from "./conceptKey";

export interface PersonaSplit {
  /**
   * True when there is no usable ledger — anonymous reader, empty
   * history, or a persona-store failure. Renderers treat this as "assume
   * a smart reader new to the field" and never block on it.
   */
  uncalibrated: boolean;
  known: ConceptMastery[];
  /** Seen but not yet known — worth reinforcing, not re-teaching from zero. */
  seen: ConceptMastery[];
}

const UNCALIBRATED: PersonaSplit = { uncalibrated: true, known: [], seen: [] };

/**
 * Read path of the persona graph. Never throws and never blocks an
 * explanation: any failure degrades to the uncalibrated default.
 */
export async function loadPersonaSplit(userId: string | undefined): Promise<PersonaSplit> {
  const trimmed = userId?.trim();
  if (!trimmed) {
    return UNCALIBRATED;
  }

  try {
    const ledger = await fetchConceptLedgerForUser(trimmed);
    if (ledger.length === 0) {
      return UNCALIBRATED;
    }

    const mastery = deriveConceptMastery(ledger);
    return {
      uncalibrated: false,
      known: mastery.filter((entry) => entry.known),
      seen: mastery.filter((entry) => !entry.known && entry.score > 0),
    };
  } catch (error) {
    console.warn("[explain] persona read failed; using uncalibrated default:", error);
    return UNCALIBRATED;
  }
}

function formatConceptList(entries: ConceptMastery[], limit: number): string {
  return entries
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => splitConceptKey(entry.conceptKey).name || entry.displayName)
    .join(", ");
}

/**
 * Renders the reader-calibration block injected into explanation
 * prompts. Flow-specific policy (e.g. QA's ask-overrides-known) is the
 * caller's responsibility — this only states what the reader knows.
 */
export function renderPersonaBlock(split: PersonaSplit, limit = 25): string {
  if (split.uncalibrated || (split.known.length === 0 && split.seen.length === 0)) {
    return [
      "# Reader Calibration",
      "Nothing is known about this reader yet. Assume a smart reader who is new to this field: define every domain term on first use and prefer concrete examples before abstractions.",
    ].join("\n");
  }

  const lines = ["# Reader Calibration"];

  if (split.known.length > 0) {
    lines.push(
      `The reader already understands: ${formatConceptList(split.known, limit)}. Build on these without re-explaining them.`,
    );
  }

  if (split.seen.length > 0) {
    lines.push(
      `The reader has encountered but not yet mastered: ${formatConceptList(split.seen, limit)}. Reinforce these briefly when they appear.`,
    );
  }

  lines.push(
    "Any concept not listed above is new to this reader — introduce it in plain language with a concrete example or analogy first.",
  );

  return lines.join("\n");
}
