import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  migrationRuns: { count: 0 },
  query: vi.fn(async () => ({ rows: [] })),
}));

vi.mock("./postgres", () => ({
  withPgClient: vi.fn(async (fn: (client: { query: typeof mocks.query }) => Promise<unknown>) => {
    mocks.migrationRuns.count += 1;
    return fn({ query: mocks.query });
  }),
}));

import { ensureSchema, resetSchemaPromise } from "./migrate";

describe("ensureSchema", () => {
  beforeEach(() => {
    resetSchemaPromise();
    mocks.migrationRuns.count = 0;
    mocks.query.mockClear();
    mocks.query.mockImplementation(async () => ({ rows: [] }));
  });

  it("memoizes: repeated calls apply the migration once", async () => {
    await ensureSchema();
    await ensureSchema();
    await ensureSchema();
    expect(mocks.migrationRuns.count).toBe(1);
  });

  it("re-applies after resetSchemaPromise — the DDL must therefore be idempotent", async () => {
    await ensureSchema();
    resetSchemaPromise();
    await ensureSchema();
    expect(mocks.migrationRuns.count).toBe(2);
  });

  it("clears the memo on failure so the next call retries", async () => {
    mocks.query.mockImplementationOnce(async () => {
      throw new Error("connection refused");
    });

    await expect(ensureSchema()).rejects.toThrow("connection refused");
    await ensureSchema();
    expect(mocks.migrationRuns.count).toBe(2);
  });
});
