/**
 * Shared persona-signal recorder used by both /qa and /summarize. Pulls
 * the concept list out of the LLM response, upserts each as a
 * persona_concept for the user, and logs the interaction.
 *
 * All writes are best-effort; callers should fire-and-forget. A failure
 * is just a missed skill update — never block the user-facing response
 * on it.
 */

import { upsertInteractions, upsertPersonaConcepts } from '@/server/db';

export interface ConceptInput {
  concept: string;
  description?: string;
}

export type PersonaInteractionType =
  | 'qa'
  | 'summarize'
  | 'selection_summary'
  | 'compare';

export interface RecordPersonaSignalsArgs {
  userId?: string;
  paperId: string;
  interactionType: PersonaInteractionType;
  prompt: string;
  response: string;
  chunkIds: string[];
  concepts: ConceptInput[];
}

const RESPONSE_TRUNCATE_LIMIT = 4000;

export async function recordPersonaSignals(
  args: RecordPersonaSignalsArgs,
): Promise<void> {
  const userId = args.userId?.trim();
  if (!userId) {
    return; // anonymous interaction — nothing to attribute.
  }

  const sanitized = args.concepts
    .map((entry) => ({
      concept: (entry?.concept ?? '').trim(),
      description: (entry?.description ?? '').trim() || undefined,
    }))
    .filter((entry) => entry.concept.length > 0)
    .slice(0, 6);

  let conceptIds: string[] = [];
  if (sanitized.length > 0) {
    conceptIds = await upsertPersonaConcepts(
      sanitized.map((entry) => ({
        userId,
        concept: entry.concept,
        description: entry.description,
        firstSeenPaperId: args.paperId,
        learnedAt: new Date().toISOString(),
        confidence: 0.5,
      })),
    );
  }

  const chunkIds = Array.from(
    new Set(args.chunkIds.filter((id) => id.length > 0)),
  );

  await upsertInteractions([
    {
      userId,
      paperId: args.paperId,
      interactionType: args.interactionType,
      prompt: args.prompt,
      response: args.response.slice(0, RESPONSE_TRUNCATE_LIMIT),
      chunkIds,
      personaConceptIds: conceptIds,
    },
  ]);
}
