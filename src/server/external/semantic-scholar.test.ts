import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetCacheForTests,
  enrichCitationsBatch,
  fetchByArxivId,
  fetchPapersBatch,
} from "./semantic-scholar";

const fetchMock = vi.fn();

const jsonResponse = (
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  });

const rawPaper = (id: string, title: string) => ({
  paperId: id,
  title,
  abstract: `Abstract of ${title}`,
  year: 2017,
  venue: "NeurIPS",
  authors: [{ name: "A. Author" }],
  externalIds: { ArXiv: "1706.03762" },
  openAccessPdf: { url: `https://example.org/${id}.pdf` },
  citationCount: 1234,
  url: `https://semanticscholar.org/paper/${id}`,
});

beforeEach(() => {
  _resetCacheForTests();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchPapersBatch", () => {
  it("posts prefixed ids to /paper/batch and maps results by input id", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([rawPaper("p1", "Paper One"), null, rawPaper("p3", "Paper Three")]),
    );

    const results = await fetchPapersBatch(["ARXIV:1706.03762", "DOI:10.1/missing", "DOI:10.1/x"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/paper/batch");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      ids: ["ARXIV:1706.03762", "DOI:10.1/missing", "DOI:10.1/x"],
    });

    expect(results.size).toBe(2);
    expect(results.get("ARXIV:1706.03762")?.title).toBe("Paper One");
    expect(results.get("DOI:10.1/missing")).toBeUndefined();
    expect(results.get("DOI:10.1/x")?.title).toBe("Paper Three");
  });

  it("chunks requests at 500 ids per call", async () => {
    fetchMock.mockResolvedValue(jsonResponse([]));

    const ids = Array.from({ length: 501 }, (_, index) => `DOI:10.1/${index}`);
    await fetchPapersBatch(ids);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    const secondBody = JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string);
    expect(firstBody.ids).toHaveLength(500);
    expect(secondBody.ids).toHaveLength(1);
  });

  it("returns an empty map when Semantic Scholar is down", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const results = await fetchPapersBatch(["ARXIV:1706.03762"]);

    expect(results.size).toBe(0);
  });
});

describe("rate-limit backoff", () => {
  it("honors Retry-After on 429 and retries once", async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(jsonResponse([rawPaper("p1", "Paper One")]));

    const results = await fetchPapersBatch(["ARXIV:1706.03762"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.get("ARXIV:1706.03762")?.title).toBe("Paper One");
  });

  it("gives up after a second 429", async () => {
    fetchMock.mockResolvedValue(
      new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }),
    );

    const results = await fetchPapersBatch(["ARXIV:1706.03762"]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(results.size).toBe(0);
  });
});

describe("single-flight", () => {
  it("shares one request between concurrent identical lookups", async () => {
    let resolveFetch: (value: Response) => void = () => undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );

    const first = fetchByArxivId("1706.03762");
    const second = fetchByArxivId("1706.03762");
    resolveFetch(jsonResponse(rawPaper("p1", "Paper One")));

    const [a, b] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a?.title).toBe("Paper One");
    expect(b?.title).toBe("Paper One");
  });
});

describe("enrichCitationsBatch", () => {
  it("batches id-bearing citations and bounds title-only lookups", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/paper/batch")) {
        return jsonResponse([rawPaper("p1", "Attention Is All You Need")]);
      }
      if (url.includes("/paper/search")) {
        return jsonResponse({ data: [rawPaper("p2", "Layer Normalization Methods")] });
      }
      return new Response("not found", { status: 404 });
    });

    const results = await enrichCitationsBatch([
      { key: "bib.bib1", arxivId: "1706.03762" },
      { key: "bib.bib2", title: "Layer normalization methods in deep nets", year: 2016 },
      { key: "bib.bib3", title: "short" },
    ]);

    expect(results.get("bib.bib1")?.title).toBe("Attention Is All You Need");
    expect(results.get("bib.bib2")?.title).toBe("Layer Normalization Methods");
    // Too-short titles are never used as search keys.
    expect(results.get("bib.bib3")).toBeUndefined();

    const batchCalls = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes("/paper/batch"),
    );
    const searchCalls = fetchMock.mock.calls.filter(([url]) =>
      (url as string).includes("/paper/search"),
    );
    expect(batchCalls).toHaveLength(1);
    expect(searchCalls).toHaveLength(1);
  });

  it("returns an empty map for empty input without any network call", async () => {
    const results = await enrichCitationsBatch([]);
    expect(results.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("runs title-fallback lookups with bounded concurrency", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    fetchMock.mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 0));
      inFlight -= 1;
      return jsonResponse({ data: [] });
    });

    const inputs = Array.from({ length: 7 }, (_, index) => ({
      key: `bib.bib${index}`,
      title: `A sufficiently long unique paper title number ${index}`,
    }));
    await enrichCitationsBatch(inputs);

    expect(fetchMock).toHaveBeenCalledTimes(7);
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it("stops retrying 429s after the first 429 seen within a batch", async () => {
    fetchMock.mockResolvedValue(
      new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } }),
    );

    const inputs = Array.from({ length: 4 }, (_, index) => ({
      key: `bib.bib${index}`,
      title: `A sufficiently long unique paper title number ${index}`,
    }));
    const results = await enrichCitationsBatch(inputs);

    expect(results.size).toBe(0);
    // 4 first attempts + exactly ONE Retry-After retry (the first 429
    // marks the batch; later 429s give up without sleeping).
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});

describe("enrichment deadline", () => {
  it("skips all lookups when the deadline is already exhausted", async () => {
    const results = await enrichCitationsBatch(
      [
        { key: "bib.bib1", arxivId: "1706.03762" },
        { key: "bib.bib2", title: "A sufficiently long paper title", year: 2020 },
      ],
      { deadlineMs: 0 },
    );

    expect(results.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops launching title lookups once the deadline passes mid-batch", async () => {
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(async () => {
        // Each lookup consumes more wall clock than the whole budget.
        vi.setSystemTime(Date.now() + 30_000);
        return jsonResponse({ data: [] });
      });

      const inputs = Array.from({ length: 9 }, (_, index) => ({
        key: `bib.bib${index}`,
        title: `A sufficiently long unique paper title number ${index}`,
      }));
      const results = await enrichCitationsBatch(inputs, { deadlineMs: 20_000 });

      expect(results.size).toBe(0);
      // Only the first concurrency wave (3) may have started before the
      // deadline was noticed; the remaining 6 are stored unenriched.
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(3);
    } finally {
      vi.useRealTimers();
    }
  });
});
