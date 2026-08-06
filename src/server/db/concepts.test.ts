import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SQL-shape tests for the shared concept graph, mirroring the pg mocking
 * pattern in `papers.test.ts`. Nothing here talks to Postgres — the point
 * is to pin the conflict semantics, which are the whole of this module's
 * behavior and are otherwise only observable against a live database.
 */

const mocks = vi.hoisted(() => {
  const statements: string[] = [];
  const params: unknown[][] = [];
  let nextRows: unknown[] = [];

  const client = {
    query: vi.fn(async (statement: string, values?: unknown[]) => {
      statements.push(statement.replace(/\s+/g, " ").trim());
      params.push(values ?? []);
      return { rows: nextRows };
    }),
  };

  return {
    client,
    statements,
    params,
    setRows(rows: unknown[]) {
      nextRows = rows;
    },
    reset() {
      statements.length = 0;
      params.length = 0;
      nextRows = [];
      client.query.mockClear();
    },
  };
});

vi.mock("./migrate", () => ({
  ensureSchema: vi.fn(async () => undefined),
}));

vi.mock("./postgres", () => ({
  withPgClient: vi.fn(async (fn: (client: typeof mocks.client) => Promise<unknown>) =>
    fn(mocks.client),
  ),
}));

import { upsertConceptEdges, upsertConcepts } from "./concepts";

beforeEach(() => {
  mocks.reset();
});

describe("upsertConcepts", () => {
  it("skips the round trip entirely for empty or unusable input", async () => {
    await upsertConcepts([]);
    await upsertConcepts([{ conceptKey: "   ", displayName: "Attention" }]);
    await upsertConcepts([{ conceptKey: "ml:attention", displayName: "" }]);

    expect(mocks.client.query).not.toHaveBeenCalled();
  });

  it("records the source paper and attributes the description to it", async () => {
    await upsertConcepts(
      [{ conceptKey: "ml:attention", displayName: "attention", description: "A mechanism." }],
      "1706.03762",
    );

    const [values] = mocks.params;
    expect(values).toEqual([
      "ml:attention",
      "attention",
      "A mechanism.",
      "1706.03762",
      "1706.03762",
    ]);
  });

  it("leaves description_paper_id null when the write carries no description", async () => {
    await upsertConcepts([{ conceptKey: "ml:softmax", displayName: "softmax" }], "1706.03762");

    const [values] = mocks.params;
    expect(values[2]).toBeNull(); // description
    expect(values[3]).toBe("1706.03762"); // source_paper_ids element
    expect(values[4]).toBeNull(); // description_paper_id
  });

  it("treats a missing or blank paper id as unknown origin, not as an empty-string paper", async () => {
    await upsertConcepts([{ conceptKey: "ml:softmax", displayName: "softmax" }]);
    await upsertConcepts([{ conceptKey: "ml:softmax", displayName: "softmax" }], "   ");

    expect(mocks.params[0][3]).toBeNull();
    expect(mocks.params[1][3]).toBeNull();
  });

  it("dedupe-appends the paper rather than replacing the array", async () => {
    await upsertConcepts([{ conceptKey: "ml:attention", displayName: "attention" }], "1706.03762");

    const [sql] = mocks.statements;
    expect(sql).toContain("source_paper_ids = CASE");
    expect(sql).toContain("$4::text = ANY(concepts.source_paper_ids)");
    expect(sql).toContain("ELSE array_append(concepts.source_paper_ids, $4::text)");
    // The stored array must never be overwritten wholesale.
    expect(sql).not.toContain("source_paper_ids = EXCLUDED.source_paper_ids");
  });

  it("is first-write-wins on both shared text fields", async () => {
    await upsertConcepts([{ conceptKey: "ml:attention", displayName: "attention" }], "1706.03762");

    const [sql] = mocks.statements;
    // The stored value comes first in each COALESCE: a later paper fills a
    // gap but can never overwrite text another paper already supplied.
    expect(sql).toContain("description = COALESCE(concepts.description, EXCLUDED.description)");
    expect(sql).toContain("display_name = COALESCE( NULLIF(concepts.display_name, '')");
    // The pre-provenance shape, which let any later paper poison the
    // shared description for every reader.
    expect(sql).not.toContain("COALESCE(EXCLUDED.description, concepts.description)");
  });

  it("only re-attributes the description on the write that actually stores it", async () => {
    await upsertConcepts(
      [{ conceptKey: "ml:attention", displayName: "attention", description: "A mechanism." }],
      "1706.03762",
    );

    const [sql] = mocks.statements;
    expect(sql).toContain(
      "description_paper_id = CASE WHEN concepts.description IS NULL AND EXCLUDED.description IS NOT NULL THEN EXCLUDED.description_paper_id ELSE concepts.description_paper_id END",
    );
  });
});

describe("upsertConceptEdges", () => {
  it("drops empty, self-referential, and blank-keyed edges before querying", async () => {
    await upsertConceptEdges([]);
    await upsertConceptEdges([{ fromKey: "ml:attention", toKey: "ml:attention", source: "llm" }]);
    await upsertConceptEdges([{ fromKey: "  ", toKey: "ml:softmax", source: "llm" }]);

    expect(mocks.client.query).not.toHaveBeenCalled();
  });

  it("records the source paper alongside the edge", async () => {
    await upsertConceptEdges(
      [{ fromKey: "ml:transformer", toKey: "ml:attention", confidence: 0.9, source: "citation" }],
      "1706.03762",
    );

    expect(mocks.params[0]).toEqual([
      "ml:transformer",
      "ml:attention",
      "depends_on",
      0.9,
      "citation",
      "1706.03762",
    ]);
  });

  it("dedupe-appends the paper so one paper cannot inflate corroboration", async () => {
    await upsertConceptEdges(
      [{ fromKey: "ml:transformer", toKey: "ml:attention", source: "llm" }],
      "1706.03762",
    );

    const [sql] = mocks.statements;
    expect(sql).toContain("paper_ids = CASE");
    expect(sql).toContain("$6::text = ANY(concept_edges.paper_ids)");
    expect(sql).toContain("ELSE array_append(concept_edges.paper_ids, $6::text)");
    expect(sql).not.toContain("paper_ids = EXCLUDED.paper_ids");
  });

  it("keeps the confidence ratchet (highest wins) untouched", async () => {
    await upsertConceptEdges(
      [{ fromKey: "ml:transformer", toKey: "ml:attention", source: "llm" }],
      "1706.03762",
    );

    expect(mocks.statements[0]).toContain(
      "confidence = GREATEST( COALESCE(EXCLUDED.confidence, 0), COALESCE(concept_edges.confidence, 0) )",
    );
  });
});
