import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCacheForTests,
  enrichCitation,
  enrichCitationsBatch,
  fetchByArxivId,
  fetchByDoi,
  searchByTitle,
} from "../semantic-scholar";

const ENV_KEYS = [
  "SEMANTIC_SCHOLAR_KEY",
  "SEMANTIC_SCHOLAR_API_URL",
  "SEMANTIC_SCHOLAR_TIMEOUT_MS",
];

function snapshotEnv(): Record<string, string | undefined> {
  const snapshot: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  return snapshot;
}

function restoreEnv(snapshot: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
}

const mockFetch = vi.fn();

beforeEach(() => {
  _resetCacheForTests();
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Semantic Scholar client — fetchByDoi", () => {
  it("shapes the response into a SemanticScholarPaper", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        paperId: "ss-1",
        title: "Attention Is All You Need",
        abstract: "We propose...",
        year: 2017,
        venue: "NeurIPS",
        authors: [{ name: "Vaswani" }, { name: "Shazeer" }, {}],
        externalIds: { DOI: "10.48550/arXiv.1706.03762", ArXiv: "1706.03762" },
        openAccessPdf: { url: "https://arxiv.org/pdf/1706.03762.pdf" },
        citationCount: 80000,
        url: "https://semanticscholar.org/paper/ss-1",
      }),
    );

    const result = await fetchByDoi("10.48550/arXiv.1706.03762");

    expect(result).toMatchObject({
      paperId: "ss-1",
      title: "Attention Is All You Need",
      year: 2017,
      venue: "NeurIPS",
      authors: ["Vaswani", "Shazeer"],
      doi: "10.48550/arXiv.1706.03762",
      arxivId: "1706.03762",
      openAccessPdfUrl: "https://arxiv.org/pdf/1706.03762.pdf",
      citationCount: 80000,
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("caches results across calls", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ paperId: "ss-1", title: "X" }));
    await fetchByDoi("10.1/abc");
    await fetchByDoi("10.1/abc");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns undefined for 404", async () => {
    mockFetch.mockResolvedValueOnce(new Response("not found", { status: 404 }));
    const result = await fetchByDoi("10.1/missing");
    expect(result).toBeUndefined();
  });

  it("caches negative responses too", async () => {
    mockFetch.mockResolvedValue(new Response("not found", { status: 404 }));
    await fetchByDoi("10.1/missing");
    await fetchByDoi("10.1/missing");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns undefined and does not throw on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));
    const result = await fetchByDoi("10.1/whatever");
    expect(result).toBeUndefined();
  });

  it("attaches x-api-key header when SEMANTIC_SCHOLAR_KEY is set", async () => {
    const original = snapshotEnv();
    try {
      process.env.SEMANTIC_SCHOLAR_KEY = "secret-key";
      mockFetch.mockResolvedValueOnce(jsonResponse({ paperId: "ss-1" }));
      await fetchByDoi("10.1/abc");
      const call = mockFetch.mock.calls[0]!;
      const init = call[1] as RequestInit;
      const headers = init.headers as Record<string, string>;
      expect(headers["x-api-key"]).toBe("secret-key");
    } finally {
      restoreEnv(original);
    }
  });
});

describe("Semantic Scholar client — fetchByArxivId", () => {
  it("targets the ARXIV: prefix endpoint", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ paperId: "ss-2" }));
    await fetchByArxivId("1706.03762");
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/paper/ARXIV:1706.03762");
  });
});

describe("Semantic Scholar client — searchByTitle", () => {
  it("returns the first hit", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({
        data: [
          { paperId: "first", title: "First match" },
          { paperId: "second", title: "Worse match" },
        ],
      }),
    );
    const result = await searchByTitle("Attention Is All You Need", 2017);
    expect(result?.paperId).toBe("first");
  });

  it("passes year as a query param when provided", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await searchByTitle("Pinned title", 2024);
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("year=2024");
  });
});

describe("enrichCitation precedence", () => {
  it("prefers arxivId over doi over title", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ paperId: "arxiv-hit" }));
    const result = await enrichCitation({
      arxivId: "1706.03762",
      doi: "10.1/x",
      title: "A title",
    });
    expect(result?.paperId).toBe("arxiv-hit");
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("/paper/ARXIV:");
  });

  it("falls back to title only when title.length >= 12 and year present", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [{ paperId: "searched" }] }));
    const result = await enrichCitation({ title: "A long enough title", year: 2024 });
    expect(result?.paperId).toBe("searched");
  });

  it("skips title-only lookups when title is too short", async () => {
    const result = await enrichCitation({ title: "short" });
    expect(result).toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe("enrichCitationsBatch — one work cited under several keys", () => {
  it("enriches every key that resolved to the same id", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ paperId: "shared" }]));

    const results = await enrichCitationsBatch([
      { key: "bib1", arxivId: "1706.03762" },
      { key: "bib7", arxivId: "1706.03762" },
    ]);

    // Before this was a Map<string, string[]>, the second key overwrote the
    // first and bib1 silently received no enrichment.
    expect(results.get("bib1")?.paperId).toBe("shared");
    expect(results.get("bib7")?.paperId).toBe("shared");
  });

  it("spends one batch slot per distinct id, not per citation", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ paperId: "shared" }]));

    await enrichCitationsBatch([
      { key: "bib1", doi: "10.1/x" },
      { key: "bib7", doi: "10.1/x" },
    ]);

    const init = mockFetch.mock.calls[0]![1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ ids: ["DOI:10.1/x"] });
  });

  it("still maps distinct ids to their own keys", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([{ paperId: "first" }, { paperId: "second" }]));

    const results = await enrichCitationsBatch([
      { key: "bib1", arxivId: "1706.03762" },
      { key: "bib2", doi: "10.1/y" },
    ]);

    expect(results.get("bib1")?.paperId).toBe("first");
    expect(results.get("bib2")?.paperId).toBe("second");
  });
});
