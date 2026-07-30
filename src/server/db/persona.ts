import { buildInteractionUuid, buildPersonaConceptUuid } from "./ids";
import { ensureSchema } from "./migrate";
import { withPgClient } from "./postgres";
import type { ConceptLedgerEntry, ConceptSignalType, Interaction, PersonaConcept } from "./types";

export async function listPersonaConceptsForUser(
  userId: string,
  limit = 100,
): Promise<PersonaConcept[]> {
  if (!userId.trim()) {
    return [];
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string;
      concept: string;
      description: string | null;
      first_seen_paper_id: string | null;
      learned_at: Date | null;
      confidence: number | null;
    }>(
      `SELECT id, user_id, concept, description, first_seen_paper_id, learned_at, confidence
         FROM persona_concepts
         WHERE user_id = $1
         ORDER BY learned_at DESC NULLS LAST, concept ASC
         LIMIT $2`,
      [userId.trim(), limit],
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      concept: row.concept,
      description: row.description ?? undefined,
      firstSeenPaperId: row.first_seen_paper_id ?? undefined,
      learnedAt: row.learned_at?.toISOString(),
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    }));
  });
}

export async function upsertPersonaConcepts(concepts: PersonaConcept[]): Promise<string[]> {
  if (concepts.length === 0) {
    return [];
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    const ids: string[] = [];
    for (const concept of concepts) {
      const id = concept.id ?? buildPersonaConceptUuid(concept.userId, concept.concept);
      await client.query(
        `
        INSERT INTO persona_concepts (
          id,
          user_id,
          concept,
          description,
          first_seen_paper_id,
          learned_at,
          confidence
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (user_id, concept) DO UPDATE SET
          description = COALESCE(EXCLUDED.description, persona_concepts.description),
          first_seen_paper_id = COALESCE(EXCLUDED.first_seen_paper_id, persona_concepts.first_seen_paper_id),
          learned_at = COALESCE(EXCLUDED.learned_at, persona_concepts.learned_at),
          confidence = COALESCE(EXCLUDED.confidence, persona_concepts.confidence)
        `,
        [
          id,
          concept.userId,
          concept.concept,
          concept.description ?? null,
          concept.firstSeenPaperId ?? null,
          concept.learnedAt ?? null,
          typeof concept.confidence === "number" ? concept.confidence : null,
        ],
      );
      ids.push(id);
    }
    return ids;
  });
}

export interface RecordConceptSignalArgs {
  userId: string;
  paperId: string;
  signal: ConceptSignalType;
  concepts: Array<{
    conceptKey: string;
    displayName: string;
    description?: string;
  }>;
}

/**
 * Append-semantics ledger write: one typed signal per concept. For
 * ledger rows the `concept` column stores the normalized concept_key
 * (the UNIQUE(user_id, concept) constraint is the upsert target) and
 * `display_name` carries the human-readable name. Every write bumps
 * exposure_count, adds the paper to the distinct set, refreshes
 * last_seen_at, and increments the per-signal counter. known/new is
 * derived at read time — never written here.
 */
export async function recordConceptSignal(args: RecordConceptSignalArgs): Promise<string[]> {
  const userId = args.userId.trim();
  if (!userId) {
    return [];
  }

  const concepts = args.concepts.filter((concept) => concept.conceptKey.trim());
  if (concepts.length === 0) {
    return [];
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    const ids: string[] = [];
    for (const concept of concepts) {
      const conceptKey = concept.conceptKey.trim();
      const id = buildPersonaConceptUuid(userId, conceptKey);
      await client.query(
        `
        INSERT INTO persona_concepts (
          id,
          user_id,
          concept,
          display_name,
          description,
          first_seen_paper_id,
          learned_at,
          exposure_count,
          distinct_paper_ids,
          last_seen_at,
          signal_counts
        ) VALUES ($1,$2,$3,$4,$5,$6,NOW(),1,ARRAY[$6::text],NOW(), jsonb_build_object($7::text, 1))
        ON CONFLICT (user_id, concept) DO UPDATE SET
          display_name = COALESCE(EXCLUDED.display_name, persona_concepts.display_name),
          description = COALESCE(EXCLUDED.description, persona_concepts.description),
          first_seen_paper_id = COALESCE(persona_concepts.first_seen_paper_id, EXCLUDED.first_seen_paper_id),
          exposure_count = persona_concepts.exposure_count + 1,
          distinct_paper_ids = CASE
            WHEN $6 = ANY(persona_concepts.distinct_paper_ids) THEN persona_concepts.distinct_paper_ids
            ELSE array_append(persona_concepts.distinct_paper_ids, $6)
          END,
          last_seen_at = NOW(),
          signal_counts = persona_concepts.signal_counts || jsonb_build_object(
            $7::text,
            COALESCE((persona_concepts.signal_counts->>$7)::int, 0) + 1
          )
        `,
        [
          id,
          userId,
          conceptKey,
          concept.displayName,
          concept.description ?? null,
          args.paperId,
          args.signal,
        ],
      );
      ids.push(id);
    }
    return ids;
  });
}

export async function fetchConceptLedgerForUser(
  userId: string,
  limit = 500,
): Promise<ConceptLedgerEntry[]> {
  if (!userId.trim()) {
    return [];
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    const { rows } = await client.query<{
      user_id: string;
      concept: string;
      display_name: string | null;
      description: string | null;
      exposure_count: number | null;
      distinct_paper_ids: string[] | null;
      last_seen_at: Date | null;
      signal_counts: Record<string, number> | null;
    }>(
      `SELECT user_id, concept, display_name, description,
              exposure_count, distinct_paper_ids, last_seen_at, signal_counts
         FROM persona_concepts
         WHERE user_id = $1
         ORDER BY last_seen_at DESC NULLS LAST, concept ASC
         LIMIT $2`,
      [userId.trim(), limit],
    );

    return rows.map((row) => ({
      userId: row.user_id,
      conceptKey: row.concept,
      displayName: row.display_name ?? undefined,
      description: row.description ?? undefined,
      exposureCount: typeof row.exposure_count === "number" ? row.exposure_count : 0,
      distinctPaperIds: row.distinct_paper_ids ?? [],
      lastSeenAt: row.last_seen_at?.toISOString(),
      signalCounts: (row.signal_counts ?? {}) as ConceptLedgerEntry["signalCounts"],
    }));
  });
}

export async function upsertInteractions(interactions: Interaction[]): Promise<string[]> {
  if (interactions.length === 0) {
    return [];
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    const ids: string[] = [];
    for (const interaction of interactions) {
      const id =
        interaction.id ??
        buildInteractionUuid(
          interaction.userId,
          interaction.paperId,
          interaction.interactionType,
          interaction.prompt,
        );

      await client.query(
        `
        INSERT INTO interactions (
          id,
          user_id,
          paper_id,
          interaction_type,
          prompt,
          response,
          chunk_ids,
          persona_concept_ids,
          created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9, NOW()))
        ON CONFLICT (id) DO UPDATE SET
          response = COALESCE(EXCLUDED.response, interactions.response),
          chunk_ids = EXCLUDED.chunk_ids,
          persona_concept_ids = EXCLUDED.persona_concept_ids
        `,
        [
          id,
          interaction.userId,
          interaction.paperId,
          interaction.interactionType,
          interaction.prompt,
          interaction.response ?? null,
          interaction.chunkIds ?? [],
          interaction.personaConceptIds ?? [],
          interaction.createdAt ?? null,
        ],
      );
      ids.push(id);
    }
    return ids;
  });
}
