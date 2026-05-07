import {
  buildInteractionUuid,
  buildPersonaConceptUuid,
} from './ids';
import { ensureSchema } from './migrate';
import { withPgClient } from './postgres';
import type { Interaction, PersonaConcept } from './types';

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
      confidence:
        typeof row.confidence === 'number' ? row.confidence : undefined,
    }));
  });
}

export async function upsertPersonaConcepts(
  concepts: PersonaConcept[],
): Promise<string[]> {
  if (concepts.length === 0) {
    return [];
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    const ids: string[] = [];
    for (const concept of concepts) {
      const id =
        concept.id ?? buildPersonaConceptUuid(concept.userId, concept.concept);
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
          typeof concept.confidence === 'number' ? concept.confidence : null,
        ],
      );
      ids.push(id);
    }
    return ids;
  });
}

export async function upsertInteractions(
  interactions: Interaction[],
): Promise<string[]> {
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

