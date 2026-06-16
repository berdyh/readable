import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchArxivMetadata: vi.fn(),
  fetchAr5ivHtml: vi.fn(),
  fetchTextWithTimeout: vi.fn(),
}));

vi.mock("@/server/ingest/arxiv", () => ({
  fetchArxivMetadata: mocks.fetchArxivMetadata,
  fetchAr5ivHtml: mocks.fetchAr5ivHtml,
}));

vi.mock("@/server/ingest/utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/ingest/utils")>();
  return {
    ...actual,
    fetchTextWithTimeout: mocks.fetchTextWithTimeout,
  };
});

import { ingestArxivInline } from "./ingest";

const htmlWithRelativeFigure = `
  <html>
    <body>
      <article>
        <section id="S1">
          <h2>Introduction</h2>
          <p>Readable public HTML should preserve figures.</p>
        </section>
        <figure id="fig-overview">
          <img src="figures/overview.svg" />
          <figcaption><span>Figure 1:</span> Overview.</figcaption>
        </figure>
      </article>
    </body>
  </html>
`;

describe("ingestArxivInline", () => {
  let originalAr5ivBaseUrl: string | undefined;

  beforeEach(() => {
    originalAr5ivBaseUrl = process.env.AR5IV_BASE_URL;
    process.env.AR5IV_BASE_URL = "https://ar5iv.example/html";
    vi.clearAllMocks();
    mocks.fetchArxivMetadata.mockResolvedValue({
      id: "2401.01234v1",
      title: "Inline Reader",
      authors: ["Readable"],
      categories: ["cs.CL"],
    });
  });

  afterEach(() => {
    if (originalAr5ivBaseUrl === undefined) {
      delete process.env.AR5IV_BASE_URL;
    } else {
      process.env.AR5IV_BASE_URL = originalAr5ivBaseUrl;
    }
  });

  it("resolves relative ar5iv figure images against the paper HTML URL", async () => {
    mocks.fetchAr5ivHtml.mockResolvedValue(htmlWithRelativeFigure);

    const result = await ingestArxivInline("2401.01234");

    expect(result.figures[0]?.imageUrl).toBe(
      "https://ar5iv.example/html/2401.01234/figures/overview.svg",
    );
    expect(mocks.fetchAr5ivHtml).toHaveBeenCalledWith(
      "2401.01234",
      expect.objectContaining({ ar5ivBaseUrl: "https://ar5iv.example/html" }),
    );
  });

  it("resolves fallback HTML figure images against the fetched fallback page", async () => {
    mocks.fetchAr5ivHtml.mockRejectedValue(new Error("ar5iv unavailable"));
    mocks.fetchTextWithTimeout.mockResolvedValueOnce(htmlWithRelativeFigure);

    const result = await ingestArxivInline("2401.01234");

    expect(result.figures[0]?.imageUrl).toBe(
      "https://arxiv.org/html/2401.01234/figures/overview.svg",
    );
    expect(mocks.fetchTextWithTimeout).toHaveBeenCalledWith(
      "https://arxiv.org/html/2401.01234",
      expect.any(Number),
    );
  });
});
