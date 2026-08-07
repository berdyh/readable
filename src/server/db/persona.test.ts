import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SQL-shape tests for the mastery ledger, mirroring the pg mocking pattern
 * in `papers.test.ts` and `concepts.test.ts`. Nothing here talks to
 * Postgres — the point is to pin the conflict semantics of
 * `recordConceptSignal`, which are the whole of this write's behavior and
 * are otherwise only observable against a live database.
 *
 * Every clause below fails silently when it is wrong: the write still
 * succeeds, and the ledger just holds a number nobody notices is off.
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

import { buildPersonaConceptUuid } from "./ids";
import {
  fetchConceptLedgerForUser,
  listPersonaConceptsForUser,
  recordConceptSignal,
} from "./persona";

beforeEach(() => {
  mocks.reset();
});

/** Parameter positions in the ledger upsert, by name. */
const P = {
  id: 0,
  userId: 1,
  conceptKey: 2,
  displayName: 3,
  description: 4,
  paperId: 5,
  signal: 6,
} as const;

describe("recordConceptSignal input handling", () => {
  it("skips the round trip entirely for an anonymous or unusable write", async () => {
    expect(
      await recordConceptSignal({
        userId: "   ",
        paperId: "1706.03762",
        signal: "summary_exposure",
        concepts: [{ conceptKey: "ml:attention", displayName: "attention" }],
      }),
    ).toEqual([]);

    expect(
      await recordConceptSignal({
        userId: "user_1",
        paperId: "1706.03762",
        signal: "summary_exposure",
        concepts: [],
      }),
    ).toEqual([]);

    expect(
      await recordConceptSignal({
        userId: "user_1",
        paperId: "1706.03762",
        signal: "summary_exposure",
        concepts: [{ conceptKey: "   ", displayName: "attention" }],
      }),
    ).toEqual([]);

    expect(mocks.client.query).not.toHaveBeenCalled();
  });

  it("writes one row per concept, keyed on the normalized concept key", async () => {
    const ids = await recordConceptSignal({
      userId: " user_1 ",
      paperId: "1706.03762",
      signal: "qa_asked",
      concepts: [
        { conceptKey: " ml:attention ", displayName: "attention", description: "A mechanism." },
        { conceptKey: "ml:softmax", displayName: "softmax" },
      ],
    });

    expect(mocks.params).toHaveLength(2);
    expect(mocks.params[0][P.userId]).toBe("user_1");
    expect(mocks.params[0][P.conceptKey]).toBe("ml:attention");
    expect(mocks.params[0][P.displayName]).toBe("attention");
    expect(mocks.params[0][P.description]).toBe("A mechanism.");
    expect(mocks.params[0][P.paperId]).toBe("1706.03762");
    expect(mocks.params[0][P.signal]).toBe("qa_asked");

    // The `concept` column stores the key and `display_name` the label. A
    // swap here is invisible at write time and silently splits one ledger
    // row into one per casing/spelling of the human-readable name.
    expect(mocks.params[1][P.conceptKey]).toBe("ml:softmax");
    expect(mocks.params[1][P.displayName]).toBe("softmax");

    // An absent description is a SQL NULL, which is what makes the
    // COALESCE below a no-op rather than an erasure.
    expect(mocks.params[1][P.description]).toBeNull();

    expect(ids).toEqual([
      buildPersonaConceptUuid("user_1", "ml:attention"),
      buildPersonaConceptUuid("user_1", "ml:softmax"),
    ]);
  });

  it("derives the row id from user+concept only, so the ledger accumulates across papers", async () => {
    await recordConceptSignal({
      userId: "user_1",
      paperId: "1706.03762",
      signal: "summary_exposure",
      concepts: [{ conceptKey: "ml:attention", displayName: "attention" }],
    });
    await recordConceptSignal({
      userId: "user_1",
      paperId: "2005.14165",
      signal: "qa_asked",
      concepts: [{ conceptKey: "ml:attention", displayName: "attention" }],
    });
    await recordConceptSignal({
      userId: "user_2",
      paperId: "1706.03762",
      signal: "summary_exposure",
      concepts: [{ conceptKey: "ml:attention", displayName: "attention" }],
    });

    // Folding paper or signal into the id would give every exposure its own
    // row: exposure_count would sit at 1 forever and known/new could never
    // be derived at read time.
    expect(mocks.params[1][P.id]).toBe(mocks.params[0][P.id]);
    expect(mocks.params[2][P.id]).not.toBe(mocks.params[0][P.id]);
  });
});

describe("recordConceptSignal conflict semantics", () => {
  async function writeOnce(): Promise<string> {
    await recordConceptSignal({
      userId: "user_1",
      paperId: "1706.03762",
      signal: "qa_asked",
      concepts: [{ conceptKey: "ml:attention", displayName: "attention" }],
    });
    return mocks.statements[0];
  }

  it("upserts on the (user, concept) unique constraint rather than the primary key", async () => {
    const sql = await writeOnce();

    // ON CONFLICT (id) would work only while the id derivation stays in
    // sync with the constraint; the constraint is the real identity.
    expect(sql).toContain("ON CONFLICT (user_id, concept) DO UPDATE SET");
  });

  it("increments the per-signal jsonb counter and leaves the other signals alone", async () => {
    const sql = await writeOnce();

    // `||` merges the one-key object into the stored one: only $7's key is
    // rewritten, every other signal's tally is carried through untouched.
    expect(sql).toContain(
      "signal_counts = persona_concepts.signal_counts || jsonb_build_object( $7::text, COALESCE((persona_concepts.signal_counts->>$7)::int, 0) + 1 )",
    );
    // Whole-object replacement would reset every other signal to absent on
    // each write, so the ledger would only ever remember the last signal.
    expect(sql).not.toContain("signal_counts = EXCLUDED.signal_counts");
    expect(sql).not.toContain("signal_counts = jsonb_build_object");

    // The counter is read back through ->> and defaulted, so the first
    // write for a signal starts at 1 instead of nulling the column out.
    expect(sql).toContain("COALESCE((persona_concepts.signal_counts->>$7)::int, 0) + 1");

    // The insert seeds the same shape for a brand-new concept.
    expect(sql).toContain("jsonb_build_object($7::text, 1)");
  });

  it("dedupe-appends the paper to distinct_paper_ids and never overwrites the array", async () => {
    const sql = await writeOnce();

    expect(sql).toContain("distinct_paper_ids = CASE");
    expect(sql).toContain("WHEN $6 = ANY(persona_concepts.distinct_paper_ids)");
    expect(sql).toContain("THEN persona_concepts.distinct_paper_ids");
    expect(sql).toContain("ELSE array_append(persona_concepts.distinct_paper_ids, $6)");
    // Wholesale assignment would collapse the breadth signal to the single
    // most recent paper — a reader who met a concept in ten papers would
    // read as having met it in one.
    expect(sql).not.toContain("distinct_paper_ids = EXCLUDED.distinct_paper_ids");
    expect(sql).not.toContain("distinct_paper_ids = ARRAY[$6::text],");
  });

  it("counts exposure by incrementing the stored value, not by restating the insert's 1", async () => {
    const sql = await writeOnce();

    expect(sql).toContain("exposure_count = persona_concepts.exposure_count + 1");
    // EXCLUDED.exposure_count is literally 1 on every write, so using it
    // would pin every concept at one exposure forever.
    expect(sql).not.toContain("exposure_count = EXCLUDED.exposure_count");
  });

  it("keeps the description a stored value fills a gap in, never an erasure", async () => {
    const sql = await writeOnce();

    // A later signal for the same concept usually carries no description
    // (only the summarize path supplies one). It arrives as NULL, and
    // COALESCE keeps whatever is stored.
    expect(sql).toContain(
      "description = COALESCE(EXCLUDED.description, persona_concepts.description)",
    );
    expect(sql).not.toContain("description = EXCLUDED.description,");
  });

  it("keeps display_name last-write-wins with the stored name as the fallback", async () => {
    const sql = await writeOnce();

    // Unlike the shared graph in `concepts.ts`, which wraps the incoming
    // value in NULLIF(…, '') because it stores stub labels, the ledger's
    // display name always arrives from a caller that has already rejected
    // blank concept names (`sanitizeConcepts` in server/persona/record.ts).
    // The COALESCE therefore only defends against a SQL NULL.
    expect(sql).toContain(
      "display_name = COALESCE(EXCLUDED.display_name, persona_concepts.display_name)",
    );
    expect(sql).not.toContain("display_name = EXCLUDED.display_name,");
  });

  it("freezes first_seen_paper_id to the first paper, opposite to the name/description rule", async () => {
    const sql = await writeOnce();

    // Stored value first here: "first seen" must not drift to the newest
    // paper. The two COALESCE orders in this statement are deliberately
    // opposite, which is exactly the kind of thing a refactor flattens.
    expect(sql).toContain(
      "first_seen_paper_id = COALESCE(persona_concepts.first_seen_paper_id, EXCLUDED.first_seen_paper_id)",
    );
  });

  it("refreshes last_seen_at but never rewrites learned_at", async () => {
    const sql = await writeOnce();

    expect(sql).toContain("last_seen_at = NOW()");
    // learned_at is set once by the insert. Touching it on conflict would
    // make every concept look newly learned on its latest exposure.
    expect(sql).not.toContain("learned_at = NOW(),");
    expect(sql).not.toContain("learned_at = EXCLUDED.learned_at");
  });

  it("never writes a known/new verdict — that is derived at read time", async () => {
    const sql = await writeOnce();

    expect(sql).not.toContain("is_known");
    expect(sql).not.toContain("status =");
  });
});

describe("ledger read paths", () => {
  it("treats a NULL ledger column as an empty tally rather than a crash", async () => {
    mocks.setRows([
      {
        user_id: "user_1",
        concept: "ml:attention",
        display_name: null,
        description: null,
        exposure_count: null,
        distinct_paper_ids: null,
        last_seen_at: null,
        signal_counts: null,
      },
    ]);

    const [entry] = await fetchConceptLedgerForUser("user_1");

    expect(entry.exposureCount).toBe(0);
    expect(entry.distinctPaperIds).toEqual([]);
    expect(entry.signalCounts).toEqual({});
    expect(entry.displayName).toBeUndefined();
    expect(entry.lastSeenAt).toBeUndefined();
  });

  it("returns the ledger under the concept key, not the display name", async () => {
    mocks.setRows([
      {
        user_id: "user_1",
        concept: "ml:attention",
        display_name: "Attention",
        description: "A mechanism.",
        exposure_count: 3,
        distinct_paper_ids: ["1706.03762", "2005.14165"],
        last_seen_at: new Date("2026-01-02T03:04:05.000Z"),
        signal_counts: { qa_asked: 2, summary_exposure: 1 },
      },
    ]);

    const [entry] = await fetchConceptLedgerForUser("user_1");

    expect(entry.conceptKey).toBe("ml:attention");
    expect(entry.displayName).toBe("Attention");
    expect(entry.exposureCount).toBe(3);
    expect(entry.distinctPaperIds).toEqual(["1706.03762", "2005.14165"]);
    expect(entry.signalCounts).toEqual({ qa_asked: 2, summary_exposure: 1 });
    expect(entry.lastSeenAt).toBe("2026-01-02T03:04:05.000Z");
  });

  it("scopes both reads to the requesting user and never queries for an anonymous one", async () => {
    expect(await fetchConceptLedgerForUser("  ")).toEqual([]);
    expect(await listPersonaConceptsForUser("  ")).toEqual([]);
    expect(mocks.client.query).not.toHaveBeenCalled();

    await fetchConceptLedgerForUser(" user_1 ", 25);
    await listPersonaConceptsForUser(" user_1 ", 25);

    for (const values of mocks.params) {
      expect(values).toEqual(["user_1", 25]);
    }
    for (const sql of mocks.statements) {
      expect(sql).toContain("WHERE user_id = $1");
      expect(sql).toContain("LIMIT $2");
    }
  });
});
