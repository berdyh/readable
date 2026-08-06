import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  let nextClientId = 1;
  let lockHeld = false;
  let lockWaiters: Array<() => void> = [];

  const acquireLock = async (clientId: number) => {
    if (lockHeld) {
      events.push(`lock-wait:${clientId}`);
      await new Promise<void>((resolve) => {
        lockWaiters.push(resolve);
      });
    }

    lockHeld = true;
  };

  const releaseLock = () => {
    const next = lockWaiters.shift();
    if (next) {
      next();
      return;
    }

    lockHeld = false;
  };

  const statements: string[] = [];

  const createClient = () => {
    const clientId = nextClientId;
    nextClientId += 1;

    return {
      query: vi.fn(async (statement: string) => {
        const sql = statement.replace(/\s+/g, " ").trim();
        statements.push(sql);

        if (sql.includes("pg_advisory_lock")) {
          await acquireLock(clientId);
          events.push(`lock:${clientId}`);
        } else if (sql.includes("pg_advisory_unlock")) {
          events.push(`unlock:${clientId}`);
          releaseLock();
        } else if (sql === "BEGIN") {
          events.push(`begin:${clientId}`);
        } else if (sql === "COMMIT") {
          events.push(`commit:${clientId}`);
        } else if (sql === "ROLLBACK") {
          events.push(`rollback:${clientId}`);
        }

        return { rows: [] };
      }),
    };
  };

  const reset = () => {
    events.length = 0;
    statements.length = 0;
    nextClientId = 1;
    lockHeld = false;
    lockWaiters = [];
  };

  return { createClient, events, statements, reset };
});

vi.mock("./migrate", () => ({
  ensureSchema: vi.fn(async () => undefined),
}));

vi.mock("./postgres", () => ({
  withPgClient: vi.fn(
    async (fn: (client: ReturnType<typeof mocks.createClient>) => Promise<unknown>) =>
      fn(mocks.createClient()),
  ),
}));

import { compareChunksByDocumentOrder, replacePaperIngestData, upsertCitations } from "./papers";

describe("upsertCitations", () => {
  beforeEach(() => {
    mocks.reset();
  });

  it("preserves persisted enrichment on unenriched re-ingest (COALESCE semantics)", async () => {
    await upsertCitations([
      {
        paperId: "2401.00001",
        citationId: "bib.bib1",
        title: "Layer normalization",
      },
    ]);

    const upsert = mocks.statements.find((sql) => sql.startsWith("INSERT INTO paper_citations"));
    expect(upsert).toBeDefined();

    for (const column of [
      "abstract",
      "arxiv_id",
      "venue",
      "citation_count",
      "open_access_pdf_url",
      "enriched_at",
    ]) {
      expect(upsert).toContain(
        `${column} = COALESCE(EXCLUDED.${column}, paper_citations.${column})`,
      );
    }

    // Base fields must not null-overwrite stored values either.
    expect(upsert).toContain("title = COALESCE(NULLIF(EXCLUDED.title, ''), paper_citations.title)");
    expect(upsert).toContain("year = COALESCE(EXCLUDED.year, paper_citations.year)");
  });
});

describe("compareChunksByDocumentOrder", () => {
  it("orders by token_start ordinal when both rows carry one", () => {
    const rows = [
      { chunkId: "S9-p1", tokenStart: 2 },
      { chunkId: "S1-p1", tokenStart: 0 },
      { chunkId: "S2-p1", tokenStart: 1 },
    ];
    rows.sort(compareChunksByDocumentOrder);
    expect(rows.map((row) => row.chunkId)).toEqual(["S1-p1", "S2-p1", "S9-p1"]);
  });

  it("natural-sorts legacy rows without token_start (regression pin: S10 must follow S2)", () => {
    // The original `ORDER BY chunk_id ASC` was lexicographic: "S10-p1" < "S2-p1",
    // which shuffled the back half of every paper out of reading order.
    const rows = [
      { chunkId: "S10-p1", tokenStart: undefined },
      { chunkId: "S2-p10", tokenStart: undefined },
      { chunkId: "S2-p2", tokenStart: undefined },
      { chunkId: "S1-p1", tokenStart: undefined },
    ];
    rows.sort(compareChunksByDocumentOrder);
    expect(rows.map((row) => row.chunkId)).toEqual(["S1-p1", "S2-p2", "S2-p10", "S10-p1"]);
  });

  it("breaks token_start ties and mixed rows via natural chunk_id order", () => {
    const rows = [
      { chunkId: "S1-p10", tokenStart: 5 },
      { chunkId: "S1-p2", tokenStart: 5 },
    ];
    rows.sort(compareChunksByDocumentOrder);
    expect(rows.map((row) => row.chunkId)).toEqual(["S1-p2", "S1-p10"]);
  });
});

describe("replacePaperIngestData", () => {
  beforeEach(() => {
    mocks.reset();
  });

  it("holds the paper ingest advisory lock until afterCommit finishes", async () => {
    const result = await replacePaperIngestData(
      {
        paper: {
          paperId: "2401.00001",
          title: "Serialized ingest",
          authors: ["Readable"],
          categories: [],
        },
        chunks: [
          {
            paperId: "2401.00001",
            chunkId: "S1-p1",
            text: "Replacement chunk",
            citations: [],
            figureIds: [],
          },
        ],
        figures: [],
        citations: [],
      },
      {
        afterCommit: async () => {
          mocks.events.push("afterCommit:start");
          await Promise.resolve();
          mocks.events.push("afterCommit:end");
        },
      },
    );

    expect(result.chunkIds).toHaveLength(1);
    expect(mocks.events.indexOf("lock:1")).toBeLessThan(mocks.events.indexOf("begin:1"));
    expect(mocks.events.indexOf("commit:1")).toBeLessThan(
      mocks.events.indexOf("afterCommit:start"),
    );
    expect(mocks.events.indexOf("afterCommit:end")).toBeLessThan(mocks.events.indexOf("unlock:1"));
  });

  it("serializes same-paper replacements until vector callback work is done", async () => {
    const releaseFirstCallback = createDeferred<void>();
    const input = {
      paper: {
        paperId: "2401.00001",
        title: "Serialized ingest",
        authors: ["Readable"],
        categories: [],
      },
      chunks: [
        {
          paperId: "2401.00001",
          chunkId: "S1-p1",
          text: "Replacement chunk",
          citations: [],
          figureIds: [],
        },
      ],
      figures: [],
      citations: [],
    };

    const first = replacePaperIngestData(input, {
      afterCommit: async () => {
        mocks.events.push("afterCommit:first:start");
        await releaseFirstCallback.promise;
        mocks.events.push("afterCommit:first:end");
      },
    });

    await waitForEvent("afterCommit:first:start");

    const second = replacePaperIngestData(input, {
      afterCommit: async () => {
        mocks.events.push("afterCommit:second");
      },
    });

    await waitForEvent("lock-wait:2");
    expect(mocks.events).not.toContain("begin:2");

    releaseFirstCallback.resolve();
    await Promise.all([first, second]);

    expect(mocks.events.indexOf("afterCommit:first:end")).toBeLessThan(
      mocks.events.indexOf("begin:2"),
    );
    expect(mocks.events.indexOf("unlock:1")).toBeLessThan(mocks.events.indexOf("lock:2"));
  });
});

async function waitForEvent(event: string): Promise<void> {
  const start = Date.now();

  while (!mocks.events.includes(event)) {
    if (Date.now() - start > 500) {
      throw new Error(`Timed out waiting for ${event}. Events: ${mocks.events.join(", ")}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
