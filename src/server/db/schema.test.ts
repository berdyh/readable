import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { READABLE_SCHEMA_SQL } from "./schema";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL_PATH = path.join(HERE, "schema.sql");

/**
 * `schema.ts` is the runtime source of truth (applied by `ensureSchema()`); `schema.sql` is a
 * hand-mirrored copy kept for humans and SQL tooling. Nothing at runtime reads the `.sql` file, so
 * this test is the only thing standing between the two and silent drift.
 */
function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, " ") // strip line comments
    .replace(/\s+/g, " ") // collapse all whitespace
    .trim();
}

function statements(sql: string): string[] {
  return normalizeSql(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("db schema mirror", () => {
  const mirrored = readFileSync(SCHEMA_SQL_PATH, "utf8");

  it("keeps schema.sql equivalent to the runtime schema.ts DDL", () => {
    expect(statements(mirrored)).toEqual(statements(READABLE_SCHEMA_SQL));
  });

  it("compares a non-trivial statement list", () => {
    // Guards against the equality assertion above passing vacuously on two empty lists if either
    // file is ever emptied or the normalization breaks.
    expect(statements(READABLE_SCHEMA_SQL).length).toBeGreaterThan(10);
    expect(statements(mirrored).length).toBeGreaterThan(10);
  });
});

describe("schema DDL is additive and idempotent", () => {
  const ddlStatements = statements(READABLE_SCHEMA_SQL);

  it("guards every CREATE TABLE / CREATE INDEX with IF NOT EXISTS", () => {
    for (const statement of ddlStatements) {
      if (/^CREATE (UNIQUE )?(TABLE|INDEX)/i.test(statement)) {
        expect(statement, statement).toMatch(/IF NOT EXISTS/i);
      }
    }
  });

  it("guards every ALTER TABLE ADD COLUMN with IF NOT EXISTS", () => {
    const alters = ddlStatements.filter((statement) => /^ALTER TABLE/i.test(statement));
    // The migration relies on additive ALTERs — there must be some.
    expect(alters.length).toBeGreaterThan(0);
    for (const statement of alters) {
      expect(statement, statement).toMatch(/ADD COLUMN IF NOT EXISTS/i);
    }
  });

  it("contains no destructive statements", () => {
    for (const statement of ddlStatements) {
      expect(statement).not.toMatch(/^DROP /i);
      expect(statement).not.toMatch(/DROP COLUMN/i);
      expect(statement).not.toMatch(/TRUNCATE/i);
    }
  });

  it("declares the concept graph, ledger, and citation-enrichment shapes", () => {
    const sql = READABLE_SCHEMA_SQL;
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS concepts/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS concept_edges/);
    expect(sql).toMatch(/source TEXT NOT NULL CHECK \(source IN \('llm', 'citation'\)\)/);

    for (const column of [
      "abstract",
      "arxiv_id",
      "venue",
      "citation_count",
      "open_access_pdf_url",
      "enriched_at",
    ]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE paper_citations ADD COLUMN IF NOT EXISTS ${column}`),
      );
    }

    for (const column of [
      "display_name",
      "exposure_count",
      "distinct_paper_ids",
      "last_seen_at",
      "signal_counts",
    ]) {
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE persona_concepts ADD COLUMN IF NOT EXISTS ${column}`),
      );
    }
  });

  it("carries concept-graph provenance columns on both shared tables", () => {
    const sql = READABLE_SCHEMA_SQL;
    expect(sql).toMatch(
      /ALTER TABLE concepts ADD COLUMN IF NOT EXISTS source_paper_ids TEXT\[\] NOT NULL DEFAULT '\{\}'/,
    );
    expect(sql).toMatch(/ALTER TABLE concepts ADD COLUMN IF NOT EXISTS description_paper_id TEXT/);
    expect(sql).toMatch(
      /ALTER TABLE concept_edges ADD COLUMN IF NOT EXISTS paper_ids TEXT\[\] NOT NULL DEFAULT '\{\}'/,
    );
  });

  it("keeps the shared graph tables free of user_id", () => {
    // Provenance is per-paper by design: `interactions` already carries
    // user_id + paper_id + concept keys, so operator attribution is a
    // private join. A user_id column on a globally readable row would be a
    // deanonymization primitive for single-contributor concepts.
    for (const table of ["concepts", "concept_edges"]) {
      const create = ddlStatements.find((statement) =>
        new RegExp(`^CREATE TABLE IF NOT EXISTS ${table} `, "i").test(statement),
      );
      expect(create, `${table} CREATE TABLE`).toBeDefined();
      expect(create).not.toMatch(/user_id/);
      const alters = ddlStatements.filter((statement) =>
        new RegExp(`^ALTER TABLE ${table} `, "i").test(statement),
      );
      for (const alter of alters) {
        expect(alter, alter).not.toMatch(/user_id/);
      }
    }
  });

  it("does not try to widen an existing primary key", () => {
    // CREATE TABLE IF NOT EXISTS skips tables that already exist, so a key
    // change written inside one reaches fresh databases only. If a key ever
    // has to move, it needs real migration machinery, not this file.
    for (const statement of ddlStatements) {
      expect(statement).not.toMatch(/ADD (CONSTRAINT|PRIMARY KEY)/i);
      expect(statement).not.toMatch(/DROP CONSTRAINT/i);
    }
  });
});
