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
