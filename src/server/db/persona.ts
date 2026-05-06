import {
  buildInteractionUuid,
  buildKontextPromptUuid,
  buildPersonaConceptUuid,
} from './ids';
import { ensureSchema } from './migrate';
import { withPgClient } from './postgres';
import type { Interaction, KontextPrompt, PersonaConcept } from './types';

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

export async function upsertKontextPrompt(
  prompt: KontextPrompt,
): Promise<string | null> {
  await ensureSchema();

  const id =
    prompt.id ??
    buildKontextPromptUuid(
      prompt.userId,
      prompt.personaId,
      prompt.taskId,
      prompt.paperId,
    );

  if (!id) {
    return null;
  }

  return withPgClient(async (client) => {
    await client.query(
      `
      INSERT INTO kontext_prompts (
        id,
        user_id,
        persona_id,
        task_id,
        paper_id,
        system_prompt,
        fetched_at,
        expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, NOW()), $8)
      ON CONFLICT (id) DO UPDATE SET
        system_prompt = EXCLUDED.system_prompt,
        fetched_at = EXCLUDED.fetched_at,
        expires_at = EXCLUDED.expires_at
      `,
      [
        id,
        prompt.userId ?? null,
        prompt.personaId ?? null,
        prompt.taskId,
        prompt.paperId ?? null,
        prompt.systemPrompt,
        prompt.fetchedAt ?? null,
        prompt.expiresAt ?? null,
      ],
    );
    return id;
  });
}

export interface KontextPromptLookup {
  taskId: string;
  userId?: string;
  personaId?: string;
  paperId?: string;
}

export async function getCachedKontextPrompt(
  lookup: KontextPromptLookup,
): Promise<KontextPrompt | undefined> {
  await ensureSchema();

  return withPgClient(async (client) => {
    const { rows } = await client.query<{
      id: string;
      user_id: string | null;
      persona_id: string | null;
      task_id: string;
      paper_id: string | null;
      system_prompt: string;
      fetched_at: Date;
      expires_at: Date | null;
    }>(
      `SELECT id, user_id, persona_id, task_id, paper_id, system_prompt,
              fetched_at, expires_at
       FROM kontext_prompts
       WHERE task_id = $1
         AND user_id IS NOT DISTINCT FROM $2
         AND persona_id IS NOT DISTINCT FROM $3
         AND paper_id IS NOT DISTINCT FROM $4
         AND (expires_at IS NULL OR expires_at > NOW())
       ORDER BY fetched_at DESC
       LIMIT 1`,
      [
        lookup.taskId,
        lookup.userId ?? null,
        lookup.personaId ?? null,
        lookup.paperId ?? null,
      ],
    );

    const [row] = rows;
    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      userId: row.user_id ?? undefined,
      personaId: row.persona_id ?? undefined,
      taskId: row.task_id,
      paperId: row.paper_id ?? undefined,
      systemPrompt: row.system_prompt,
      fetchedAt: row.fetched_at?.toISOString(),
      expiresAt: row.expires_at?.toISOString(),
    };
  });
}
