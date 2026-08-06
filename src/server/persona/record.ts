/**
 * Persona-signal recorder shared by the explanation flows.
 *
 * Three kinds of writes, all best-effort (callers fire-and-forget):
 *   1. Global concept graph — concepts + depends_on edges. Paper-derived,
 *      not user-derived, so it is recorded even for anonymous readers.
 *   2. Per-user mastery ledger — one typed signal per concept
 *      (qa_asked / selection_explained / summary_exposure /
 *      explicit_confirmed), append semantics. Anonymous readers are never
 *      recorded (existing rule).
 *   3. Interaction log — as before.
 *
 * Summarize passes `skipLedger: true`: an auto-generated summary the
 * reader may never open is not exposure. The reader surface records
 * summary exposure explicitly (render-gated) via `recordExposureSignal`.
 */

import {
  recordConceptSignal,
  upsertConceptEdges,
  upsertConcepts,
  upsertInteractions,
  type ConceptEdgeRecord,
  type ConceptRecord,
  type ConceptSignalType,
} from "@/server/db";
import { buildConceptKey } from "@/server/explain";
import { truncateSafely } from "@/server/text";

export interface ConceptInput {
  concept: string;
  description?: string;
  /** Short field name for the domain facet (e.g. "ml"). */
  domain?: string;
  /** Prerequisite concept names (same domain unless prefixed "domain:name"). */
  dependsOn?: string[];
  /** Confidence 0-1 for the depends_on edges. */
  confidence?: number;
}

export type PersonaInteractionType = "qa" | "summarize" | "selection_summary" | "compare";

const SIGNAL_BY_INTERACTION: Record<PersonaInteractionType, ConceptSignalType> = {
  qa: "qa_asked",
  summarize: "summary_exposure",
  selection_summary: "selection_explained",
  compare: "summary_exposure",
};

export interface RecordPersonaSignalsArgs {
  userId?: string;
  paperId: string;
  interactionType: PersonaInteractionType;
  prompt: string;
  response: string;
  chunkIds: string[];
  concepts: ConceptInput[];
  /**
   * Skip the mastery-ledger write. Used by summarize: exposure is
   * recorded only when the contract content actually renders.
   */
  skipLedger?: boolean;
  /** Edge provenance for depends_on pairs; defaults to "llm". */
  edgeSource?: "llm" | "citation";
}

const RESPONSE_TRUNCATE_LIMIT = 4000;

/**
 * Shared cap on concepts persisted per interaction. The exposure route
 * enforces the same bound at parse time so garbage entries can never
 * crowd out valid ones.
 */
export const MAX_CONCEPTS_PER_INTERACTION = 8;

/**
 * Length bounds on model-supplied concept strings. These land in
 * unbounded TEXT columns and are later rendered back into prompts, so a
 * hostile paper must not be able to persist a stored prompt injection or
 * a megabyte of "concept name".
 */
export const MAX_CONCEPT_NAME_LENGTH = 80;
export const MAX_CONCEPT_DESCRIPTION_LENGTH = 240;
export const MAX_CONCEPT_DOMAIN_LENGTH = 40;

/** Strips C0/C1 control characters (keeps plain text on one line). */
function stripControlCharacters(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ");
}

function boundText(text: string, max: number): string {
  return truncateSafely(stripControlCharacters(text).trim(), max).trim();
}

interface KeyedConcept {
  key: string;
  input: ConceptInput;
}

function sanitizeConcepts(concepts: ConceptInput[]): KeyedConcept[] {
  const seen = new Set<string>();
  const keyed: KeyedConcept[] = [];

  for (const entry of concepts) {
    const name = boundText(entry?.concept ?? "", MAX_CONCEPT_NAME_LENGTH);
    if (!name) {
      continue;
    }
    const domain = entry.domain
      ? boundText(entry.domain, MAX_CONCEPT_DOMAIN_LENGTH) || undefined
      : undefined;
    const key = buildConceptKey(name, domain);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const description = entry.description
      ? boundText(entry.description, MAX_CONCEPT_DESCRIPTION_LENGTH) || undefined
      : undefined;
    keyed.push({
      key,
      input: {
        ...entry,
        concept: name,
        domain,
        description,
      },
    });
    if (keyed.length >= MAX_CONCEPTS_PER_INTERACTION) {
      break;
    }
  }

  return keyed;
}

/**
 * Writes the global graph: concept nodes plus depends_on edges.
 * Edge endpoints that are only mentioned as prerequisites get stub
 * nodes so the FK holds.
 *
 * `paperId` is the provenance of everything this call writes — nodes,
 * stub prerequisite nodes, and edges alike. It is dedupe-appended to the
 * row's paper array, which is what a later read counts for corroboration
 * and what an operator rolls back by.
 */
export async function recordConceptGraph(
  concepts: ConceptInput[],
  paperId: string,
  edgeSource: "llm" | "citation" = "llm",
): Promise<string[]> {
  const keyed = sanitizeConcepts(concepts);
  if (keyed.length === 0) {
    return [];
  }

  const nodes = new Map<string, ConceptRecord>();
  const edges: ConceptEdgeRecord[] = [];

  for (const { key, input } of keyed) {
    nodes.set(key, {
      conceptKey: key,
      displayName: input.concept,
      description: input.description,
    });

    for (const rawPrerequisite of input.dependsOn ?? []) {
      const name = boundText(rawPrerequisite, MAX_CONCEPT_NAME_LENGTH);
      if (!name) {
        continue;
      }
      const prerequisiteKey = name.includes(":")
        ? buildConceptKey(name.slice(name.indexOf(":") + 1), name.slice(0, name.indexOf(":")))
        : buildConceptKey(name, input.domain);
      if (!prerequisiteKey || prerequisiteKey === key) {
        continue;
      }
      if (!nodes.has(prerequisiteKey)) {
        nodes.set(prerequisiteKey, { conceptKey: prerequisiteKey, displayName: name });
      }
      edges.push({
        fromKey: key,
        toKey: prerequisiteKey,
        relation: "depends_on",
        confidence: typeof input.confidence === "number" ? input.confidence : undefined,
        source: edgeSource,
      });
    }
  }

  await upsertConcepts(Array.from(nodes.values()), paperId);
  if (edges.length > 0) {
    await upsertConceptEdges(edges, paperId);
  }

  return keyed.map(({ key }) => key);
}

export interface RecordExposureSignalArgs {
  userId?: string;
  paperId: string;
  concepts: ConceptInput[];
  signal?: ConceptSignalType;
}

/**
 * Ledger-only write used by the render-gated exposure path (and any
 * future explicit "I know this" confirmation). Anonymous → no-op.
 */
export async function recordExposureSignal(args: RecordExposureSignalArgs): Promise<void> {
  const userId = args.userId?.trim();
  if (!userId) {
    return;
  }

  const keyed = sanitizeConcepts(args.concepts);
  if (keyed.length === 0) {
    return;
  }

  await recordConceptSignal({
    userId,
    paperId: args.paperId,
    signal: args.signal ?? "summary_exposure",
    concepts: keyed.map(({ key, input }) => ({
      conceptKey: key,
      displayName: input.concept,
      description: input.description,
    })),
  });
}

export async function recordPersonaSignals(args: RecordPersonaSignalsArgs): Promise<void> {
  // Global graph first — paper-derived knowledge, recorded regardless of
  // who asked.
  const conceptKeys = await recordConceptGraph(
    args.concepts,
    args.paperId,
    args.edgeSource ?? "llm",
  );

  const userId = args.userId?.trim();
  if (!userId) {
    return; // anonymous interaction — nothing personal to attribute.
  }

  const keyed = sanitizeConcepts(args.concepts);

  if (!args.skipLedger && keyed.length > 0) {
    await recordConceptSignal({
      userId,
      paperId: args.paperId,
      signal: SIGNAL_BY_INTERACTION[args.interactionType],
      concepts: keyed.map(({ key, input }) => ({
        conceptKey: key,
        displayName: input.concept,
        description: input.description,
      })),
    });
  }

  const chunkIds = Array.from(new Set(args.chunkIds.filter((id) => id.length > 0)));

  await upsertInteractions([
    {
      userId,
      paperId: args.paperId,
      interactionType: args.interactionType,
      prompt: args.prompt,
      response: truncateSafely(args.response, RESPONSE_TRUNCATE_LIMIT),
      chunkIds,
      personaConceptIds: conceptKeys,
    },
  ]);
}
