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

import { fetchConceptEdgesByFromKeys, upsertConceptEdges, upsertConcepts } from "./concepts";

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

  it("is first-write-wins on the description", async () => {
    await upsertConcepts([{ conceptKey: "ml:attention", displayName: "attention" }], "1706.03762");

    const [sql] = mocks.statements;
    // The stored value comes first in the COALESCE: a later paper fills a gap
    // but can never overwrite a description another paper already supplied.
    expect(sql).toContain("description = COALESCE(concepts.description, EXCLUDED.description)");
    // The pre-provenance shape, which let any later paper poison the
    // shared description for every reader.
    expect(sql).not.toContain("COALESCE(EXCLUDED.description, concepts.description)");
  });

  it("is last-write-wins on the display name, so a stub label can be corrected", async () => {
    await upsertConcepts([{ conceptKey: "ml:attention", displayName: "attention" }], "1706.03762");

    const [sql] = mocks.statements;
    // A concept that first appears only as a prerequisite is stored under a
    // stub name — often the raw "domain:key" form (see recordConceptGraph).
    // Freezing display_name would make that stub permanent and block the real
    // label from ever landing, so the incoming value wins here.
    expect(sql).toContain("display_name = COALESCE( NULLIF(EXCLUDED.display_name, '')");
    expect(sql).not.toContain("display_name = COALESCE( NULLIF(concepts.display_name, '')");
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

describe("fetchConceptEdgesByFromKeys", () => {
  it("returns nothing without querying when every key is blank", async () => {
    expect(await fetchConceptEdgesByFromKeys([])).toEqual([]);
    expect(await fetchConceptEdgesByFromKeys(["  ", ""])).toEqual([]);
    expect(mocks.client.query).not.toHaveBeenCalled();
  });

  it("dedupes and trims the requested keys", async () => {
    await fetchConceptEdgesByFromKeys([" ml:transformer ", "ml:transformer", "ml:attention"]);

    expect(mocks.params[0]).toEqual([["ml:transformer", "ml:attention"]]);
  });

  it("returns the provenance array alongside each edge", async () => {
    mocks.setRows([
      {
        from_key: "ml:transformer",
        to_key: "ml:attention",
        relation: "depends_on",
        confidence: 0.8,
        source: "llm",
        paper_ids: ["1706.03762", "2005.14165"],
      },
    ]);

    const [edge] = await fetchConceptEdgesByFromKeys(["ml:transformer"]);
    expect(edge.paperIds).toEqual(["1706.03762", "2005.14165"]);
    expect(mocks.statements[0]).toContain("paper_ids");
  });

  it("treats a NULL paper_ids column as unknown origin, not as a crash", async () => {
    mocks.setRows([
      {
        from_key: "ml:transformer",
        to_key: "ml:attention",
        relation: "depends_on",
        confidence: null,
        source: "llm",
        paper_ids: null,
      },
    ]);

    const [edge] = await fetchConceptEdgesByFromKeys(["ml:transformer"]);
    expect(edge.paperIds).toEqual([]);
    expect(edge.confidence).toBeUndefined();
    expect(edge.corroborated).toBe(false);
  });

  it("counts distinct papers for corroboration, and trusts citation-sourced edges outright", async () => {
    mocks.setRows([
      {
        from_key: "ml:a",
        to_key: "ml:b",
        relation: "depends_on",
        confidence: null,
        source: "llm",
        paper_ids: ["p1"],
      },
      {
        from_key: "ml:a",
        to_key: "ml:c",
        relation: "depends_on",
        confidence: null,
        source: "llm",
        paper_ids: ["p1", "p2"],
      },
      {
        from_key: "ml:a",
        to_key: "ml:d",
        relation: "depends_on",
        confidence: null,
        source: "citation",
        paper_ids: ["p1"],
      },
    ]);

    const edges = await fetchConceptEdgesByFromKeys(["ml:a"]);
    expect(edges.map((edge) => edge.corroborated)).toEqual([false, true, true]);
  });
});

describe("fetchConceptEdgesByFromKeys enum handling", () => {
  /**
   * The mapper used to hard-code `relation: "depends_on"` and collapse any
   * non-"citation" source to "llm", so widening either CHECK constraint
   * would have been silently discarded on read. It now preserves any value
   * the declared union knows about; these tests pin both halves — the
   * preservation, and the fallback for a value the code has never heard of.
   */
  it("preserves every declared relation and source value", async () => {
    mocks.setRows([
      {
        from_key: "ml:a",
        to_key: "ml:b",
        relation: "depends_on",
        confidence: null,
        source: "citation",
        paper_ids: [],
      },
      {
        from_key: "ml:a",
        to_key: "ml:c",
        relation: "depends_on",
        confidence: null,
        source: "llm",
        paper_ids: [],
      },
    ]);

    const edges = await fetchConceptEdgesByFromKeys(["ml:a"]);
    expect(edges.map((edge) => edge.source)).toEqual(["citation", "llm"]);
    expect(edges.map((edge) => edge.relation)).toEqual(["depends_on", "depends_on"]);
  });

  it("falls back to the defaults for a value the code has never heard of", async () => {
    // Only reachable if the database drifts ahead of this deployment.
    // `schema.test.ts` asserts the CHECK constraints and the TypeScript
    // unions agree, so drift within one deploy fails there, loudly.
    mocks.setRows([
      {
        from_key: "ml:a",
        to_key: "ml:b",
        relation: "contradicts",
        confidence: null,
        source: "handwritten",
        paper_ids: [],
      },
    ]);

    const [edge] = await fetchConceptEdgesByFromKeys(["ml:a"]);
    expect(edge.relation).toBe("depends_on");
    expect(edge.source).toBe("llm");
  });
});
