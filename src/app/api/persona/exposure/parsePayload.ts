import {
  MAX_CONCEPT_DESCRIPTION_LENGTH,
  MAX_CONCEPT_DOMAIN_LENGTH,
  MAX_CONCEPT_NAME_LENGTH,
  MAX_CONCEPTS_PER_INTERACTION,
} from "@/server/persona";
import { truncateSafely } from "@/server/text";

/**
 * Parse/validation layer for the render-gated exposure route. Kept out
 * of route.ts so it is directly unit-testable (Next route modules may
 * only export handlers).
 */

const MAX_PAPER_ID_LENGTH = 64;

/** arXiv-shaped ids: "1706.03762", "2301.12345v2", legacy "cs/0112017". */
const PAPER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export interface ExposurePayload {
  paperId: string;
  concepts: Array<{ concept: string; domain?: string; description?: string }>;
}

function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = truncateSafely(value.trim(), max).trim();
  return trimmed || undefined;
}

export function parseExposurePayload(data: unknown): ExposurePayload {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Request body must be a JSON object.");
  }

  const record = data as Record<string, unknown>;
  const paperId = typeof record.paperId === "string" ? record.paperId.trim() : "";
  if (!paperId) {
    throw new Error("paperId is required.");
  }
  if (paperId.length > MAX_PAPER_ID_LENGTH || !PAPER_ID_PATTERN.test(paperId)) {
    throw new Error("paperId is not a valid paper id.");
  }

  if (!Array.isArray(record.concepts)) {
    throw new Error("concepts must be an array.");
  }

  // Validate first, cap after: garbage entries must never crowd valid
  // ones out of the per-interaction budget.
  const concepts = record.concepts
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return undefined;
      }
      const conceptRecord = entry as Record<string, unknown>;
      const concept = boundedString(conceptRecord.concept, MAX_CONCEPT_NAME_LENGTH);
      if (!concept) {
        return undefined;
      }
      return {
        concept,
        domain: boundedString(conceptRecord.domain, MAX_CONCEPT_DOMAIN_LENGTH),
        description: boundedString(conceptRecord.description, MAX_CONCEPT_DESCRIPTION_LENGTH),
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, MAX_CONCEPTS_PER_INTERACTION);

  if (concepts.length === 0) {
    throw new Error("concepts must include at least one named concept.");
  }

  return { paperId, concepts };
}
