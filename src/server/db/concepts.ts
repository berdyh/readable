import { ensureSchema } from "./migrate";
import { withPgClient } from "./postgres";
import { CONCEPT_EDGE_RELATIONS, CONCEPT_EDGE_SOURCES } from "./types";
import type {
  ConceptEdgeRecord,
  ConceptEdgeRelation,
  ConceptEdgeSource,
  ConceptEdgeWithProvenance,
  ConceptRecord,
} from "./types";

/**
 * Global concept graph persistence. Nodes are keyed by a normalized,
 * domain-faceted `concept_key` ("{domain}:{key}") produced by
 * `server/explain`; this module only stores what it is given.
 *
 * Every write carries the paper it was derived from. The paper is
 * dedupe-appended to `source_paper_ids` / `paper_ids` rather than stored
 * in the key, so `cardinality(...)` is the corroboration count and a bad
 * contributor can be found and rolled back. `paperId` is optional only so
 * a caller with genuinely unknown origin can still write; an empty array
 * is the documented "origin unknown" state.
 */

/**
 * Nodes are upserted first-write-wins on `description`, last-write-wins on
 * `display_name`. The two differ deliberately.
 *
 * `description` is prose: LLM output derived from arbitrary uploaded papers,
 * and the field with real blast radius if anything ever serves it across
 * users. Last-writer-wins made it an overwrite-poisoning vector — any later
 * paper could replace a good description for every reader. First-write-wins
 * plus `description_paper_id` makes the stored text attributable and rollback
 * meaningful.
 *
 * `display_name` cannot take the same rule, because a concept that first
 * appears only as a prerequisite is stored with a stub name — often the raw
 * domain-prefixed key form ("statistics:softmax"), see `recordConceptGraph`.
 * Freezing that would make the stub permanent and block the real label
 * ("Softmax") from ever landing. It stays last-write-wins, which is safe for
 * a different reason than the description: it is a short bounded label, no
 * read path serves it, and prompt composition uses the key-derived name
 * rather than this column. A read path that ever renders `display_name`
 * needs to revisit this.
 */
export async function upsertConcepts(concepts: ConceptRecord[], paperId?: string): Promise<void> {
  const valid = concepts.filter((concept) => concept.conceptKey.trim() && concept.displayName);
  if (valid.length === 0) {
    return;
  }

  await ensureSchema();

  const sourcePaperId = paperId?.trim() || null;

  await withPgClient(async (client) => {
    for (const concept of valid) {
      const description = concept.description ?? null;
      await client.query(
        `
        INSERT INTO concepts (
          concept_key,
          display_name,
          description,
          source_paper_ids,
          description_paper_id
        )
        VALUES (
          $1,
          $2,
          $3,
          CASE WHEN $4::text IS NULL THEN '{}'::text[] ELSE ARRAY[$4::text] END,
          $5
        )
        ON CONFLICT (concept_key) DO UPDATE SET
          -- Last write wins, so a real label replaces the stub name a
          -- prerequisite-only concept was first stored under.
          display_name = COALESCE(
            NULLIF(EXCLUDED.display_name, ''),
            concepts.display_name
          ),
          -- First write wins: a later paper can fill a gap but never
          -- overwrite a description that is already stored.
          description = COALESCE(concepts.description, EXCLUDED.description),
          -- Attribute the description only on the write that actually stored it.
          description_paper_id = CASE
            WHEN concepts.description IS NULL AND EXCLUDED.description IS NOT NULL
              THEN EXCLUDED.description_paper_id
            ELSE concepts.description_paper_id
          END,
          source_paper_ids = CASE
            WHEN $4::text IS NULL OR $4::text = ANY(concepts.source_paper_ids)
              THEN concepts.source_paper_ids
            ELSE array_append(concepts.source_paper_ids, $4::text)
          END,
          updated_at = NOW()
        `,
        [
          concept.conceptKey,
          concept.displayName,
          description,
          sourcePaperId,
          description === null ? null : sourcePaperId,
        ],
      );
    }
  });
}

export async function upsertConceptEdges(
  edges: ConceptEdgeRecord[],
  paperId?: string,
): Promise<void> {
  const valid = edges.filter(
    (edge) => edge.fromKey.trim() && edge.toKey.trim() && edge.fromKey !== edge.toKey,
  );
  if (valid.length === 0) {
    return;
  }

  await ensureSchema();

  const sourcePaperId = paperId?.trim() || null;

  await withPgClient(async (client) => {
    for (const edge of valid) {
      await client.query(
        `
        INSERT INTO concept_edges (from_key, to_key, relation, confidence, source, paper_ids)
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          CASE WHEN $6::text IS NULL THEN '{}'::text[] ELSE ARRAY[$6::text] END
        )
        ON CONFLICT (from_key, to_key, relation, source) DO UPDATE SET
          confidence = GREATEST(
            COALESCE(EXCLUDED.confidence, 0),
            COALESCE(concept_edges.confidence, 0)
          ),
          -- Dedupe-append: one paper asserting the same edge twice must not
          -- inflate the corroboration count that reads rank on.
          paper_ids = CASE
            WHEN $6::text IS NULL OR $6::text = ANY(concept_edges.paper_ids)
              THEN concept_edges.paper_ids
            ELSE array_append(concept_edges.paper_ids, $6::text)
          END
        `,
        [
          edge.fromKey,
          edge.toKey,
          edge.relation ?? "depends_on",
          typeof edge.confidence === "number" ? edge.confidence : null,
          edge.source,
          sourcePaperId,
        ],
      );
    }
  });
}

function asEdgeRelation(value: string): ConceptEdgeRelation {
  return (CONCEPT_EDGE_RELATIONS as readonly string[]).includes(value)
    ? (value as ConceptEdgeRelation)
    : "depends_on";
}

function asEdgeSource(value: string): ConceptEdgeSource {
  return (CONCEPT_EDGE_SOURCES as readonly string[]).includes(value)
    ? (value as ConceptEdgeSource)
    : "llm";
}

/**
 * Reads outgoing edges with their provenance.
 *
 * `corroborated` is the read-time answer to a question the write path
 * deliberately never asks: writes are never rejected, so agreement is
 * counted here instead. An edge read out of cited text is trusted on its
 * own; an LLM-asserted one needs two distinct papers to have said it.
 * A caller ranking or filtering the graph should use this rather than
 * `confidence`, which the model that produced the edge chose for itself.
 */
export async function fetchConceptEdgesByFromKeys(
  keys: string[],
): Promise<ConceptEdgeWithProvenance[]> {
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
      paper_ids: string[] | null;
    }>(
      `SELECT from_key, to_key, relation, confidence, source, paper_ids
       FROM concept_edges
       WHERE from_key = ANY($1::text[])`,
      [cleaned],
    );

    return rows.map((row) => {
      const paperIds = row.paper_ids ?? [];
      const source = asEdgeSource(row.source);
      return {
        fromKey: row.from_key,
        toKey: row.to_key,
        // Values the declared union knows about round-trip; only a database
        // that has drifted ahead of this code falls back to the default.
        relation: asEdgeRelation(row.relation),
        confidence: typeof row.confidence === "number" ? row.confidence : undefined,
        source,
        paperIds,
        corroborated: source === "citation" || paperIds.length >= 2,
      };
    });
  });
}
