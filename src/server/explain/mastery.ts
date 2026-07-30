import type { ConceptLedgerEntry, ConceptSignalType } from "@/server/db";

import { DECAY_HALF_LIFE_DAYS, MASTERY_THRESHOLD, SIGNAL_WEIGHTS } from "./constants";

export interface ConceptMastery {
  conceptKey: string;
  displayName: string;
  /** Decayed, weighted signal score. */
  score: number;
  known: boolean;
  lastSeenAt?: string;
}

const MS_PER_DAY = 24 * 60 * 60_000;

/**
 * Exponential time decay applied at read — never stored. A concept last
 * seen `DECAY_HALF_LIFE_DAYS` ago counts half as much as one seen today.
 */
export function decayFactor(lastSeenAt: string | undefined, now: Date): number {
  if (!lastSeenAt) {
    return 0;
  }
  const seen = Date.parse(lastSeenAt);
  if (!Number.isFinite(seen)) {
    return 0;
  }
  const days = Math.max(0, (now.getTime() - seen) / MS_PER_DAY);
  return Math.pow(0.5, days / DECAY_HALF_LIFE_DAYS);
}

export function scoreLedgerEntry(entry: ConceptLedgerEntry, now: Date): number {
  let rawScore = 0;
  for (const [signal, count] of Object.entries(entry.signalCounts)) {
    const weight = SIGNAL_WEIGHTS[signal as ConceptSignalType];
    if (typeof weight === "number" && typeof count === "number") {
      rawScore += weight * count;
    }
  }
  return rawScore * decayFactor(entry.lastSeenAt, now);
}

/**
 * Derives known/new from the ledger. "Seen" is not "known": a concept
 * becomes known only when its decayed weighted score crosses
 * `MASTERY_THRESHOLD`.
 */
export function deriveConceptMastery(
  entries: ConceptLedgerEntry[],
  now: Date = new Date(),
): ConceptMastery[] {
  return entries
    .filter((entry) => entry.conceptKey.trim().length > 0)
    .map((entry) => {
      const score = scoreLedgerEntry(entry, now);
      return {
        conceptKey: entry.conceptKey,
        displayName: entry.displayName ?? entry.conceptKey,
        score,
        known: score >= MASTERY_THRESHOLD,
        lastSeenAt: entry.lastSeenAt,
      };
    });
}
