import { ensureSchema } from "./migrate";
import { withPgClient } from "./postgres";
import type { ConceptEdgeRecord, ConceptRecord } from "./types";

/**
 * Global concept graph persistence. Nodes are keyed by a normalized,
 * domain-faceted `concept_key` ("{domain}:{key}") produced by
 * `server/explain`; this module only stores what it is given.
 */

export async function upsertConcepts(concepts: ConceptRecord[]): Promise<void> {
  const valid = concepts.filter((concept) => concept.conceptKey.trim() && concept.displayName);
  if (valid.length === 0) {
    return;
  }

  await ensureSchema();

  await withPgClient(async (client) => {
    for (const concept of valid) {
      await client.query(
        `
        INSERT INTO concepts (concept_key, display_name, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (concept_key) DO UPDATE SET
          description = COALESCE(EXCLUDED.description, concepts.description),
          updated_at = NOW()
        `,
        [concept.conceptKey, concept.displayName, concept.description ?? null],
      );
    }
  });
}

export async function upsertConceptEdges(edges: ConceptEdgeRecord[]): Promise<void> {
  const valid = edges.filter(
    (edge) => edge.fromKey.trim() && edge.toKey.trim() && edge.fromKey !== edge.toKey,
  );
  if (valid.length === 0) {
    return;
  }

  await ensureSchema();

  await withPgClient(async (client) => {
    for (const edge of valid) {
      await client.query(
        `
        INSERT INTO concept_edges (from_key, to_key, relation, confidence, source)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (from_key, to_key, relation, source) DO UPDATE SET
          confidence = GREATEST(
            COALESCE(EXCLUDED.confidence, 0),
            COALESCE(concept_edges.confidence, 0)
          )
        `,
        [
          edge.fromKey,
          edge.toKey,
          edge.relation ?? "depends_on",
          typeof edge.confidence === "number" ? edge.confidence : null,
          edge.source,
        ],
      );
    }
  });
}

export async function fetchConceptEdgesByFromKeys(keys: string[]): Promise<ConceptEdgeRecord[]> {
  const cleaned = Array.from(new Set(keys.map((key) => key.trim()).filter(Boolean)));
  if (cleaned.length === 0) {
    return [];
  }

  await ensureSchema();

  return withPgClient(async (client) => {
    const { rows } = await client.query<{
      from_key: string;
      to_key: string;
      relation: string;
      confidence: number | null;
      source: string;
    }>(
      `SELECT from_key, to_key, relation, confidence, source
       FROM concept_edges
       WHERE from_key = ANY($1::text[])`,
      [cleaned],
    );

    return rows.map((row) => ({
      fromKey: row.from_key,
      toKey: row.to_key,
      relation: "depends_on" as const,
      confidence: typeof row.confidence === "number" ? row.confidence : undefined,
      source: row.source === "citation" ? ("citation" as const) : ("llm" as const),
    }));
  });
}
