import { describe, expect, it } from "vitest";

import { parseAr5ivHtml } from "./ar5iv";

describe("parseAr5ivHtml", () => {
  it("parses nested ar5iv sections, paragraph refs, figure captions, and relative images", () => {
    const html = `
      <html>
        <body>
          <article id="ltx_document">
            <section id="S1" class="ltx_section">
              <h2 class="ltx_title ltx_title_section">1 Introduction</h2>
              <div class="ltx_para" id="S1.p1">
                <p class="ltx_p">
                  We build on prior work
                  <a class="ltx_ref" href="#bib.bib1">Smith et al.</a>
                  and use the overview in
                  <a class="ltx_ref" href="#S2.F1">Figure 1</a>.
                </p>
              </div>
              <section id="S1.SS1" class="ltx_subsection">
                <h3 class="ltx_title ltx_title_subsection">1.1 Nested Result</h3>
                <div class="ltx_para" id="S1.SS1.p1">
                  <p class="ltx_p">
                    The nested paragraph cites
                    <a class="ltx_ref" href="#bib.bib2">Jones</a>.
                  </p>
                </div>
              </section>
            </section>
            <figure id="S2.F1" class="ltx_figure">
              <img src="figures/overview.svg" alt="overview" />
              <figcaption class="ltx_caption">
                <span class="ltx_tag ltx_tag_figure">Figure 1:</span>
                System overview with parser inputs.
              </figcaption>
            </figure>
          </article>
        </body>
      </html>
    `;

    const result = parseAr5ivHtml(html, {
      imageBaseUrl: "https://ar5iv.org/html/2401.01234/",
    });

    expect(result.sections).toEqual([
      {
        id: "S1",
        title: "1 Introduction",
        level: 2,
        paragraphs: [
          {
            id: "S1-p1",
            text: "We build on prior work Smith et al. and use the overview in Figure 1.",
            citations: ["bib.bib1"],
            figureIds: ["S2.F1"],
          },
        ],
      },
      {
        id: "S1.SS1",
        title: "1.1 Nested Result",
        level: 3,
        paragraphs: [
          {
            id: "S1.SS1-p1",
            text: "The nested paragraph cites Jones.",
            citations: ["bib.bib2"],
            figureIds: [],
          },
        ],
      },
    ]);

    expect(result.figures).toEqual([
      {
        id: "S2.F1",
        label: "Figure 1:",
        caption: "Figure 1: System overview with parser inputs.",
        imageUrl: "https://ar5iv.org/html/2401.01234/figures/overview.svg",
      },
    ]);
  });

  it("parses plain semantic article sections with direct paragraphs and native figures", () => {
    const html = `
      <html>
        <body>
          <article>
            <section id="methods">
              <header>
                <h2>Methods</h2>
              </header>
              <p>
                We follow the replication protocol from
                <a data-bibtex-key="doe2024">Doe et al.</a>
                and compare it with
                <a href="#fig-pipeline">Figure 1</a>.
              </p>
              <p>
                The article also includes a plain paragraph without references.
              </p>
            </section>
            <figure id="fig-pipeline">
              <img src="/assets/pipeline.png" alt="pipeline" />
              <figcaption>
                <span class="figure-label">Figure 1.</span>
                Pipeline overview rendered by semantic article markup.
              </figcaption>
            </figure>
          </article>
        </body>
      </html>
    `;

    const result = parseAr5ivHtml(html, {
      imageBaseUrl: "https://example.test",
    });

    expect(result.sections).toEqual([
      {
        id: "methods",
        title: "Methods",
        level: 2,
        paragraphs: [
          {
            id: "methods-p1",
            text: "We follow the replication protocol from Doe et al. and compare it with Figure 1.",
            citations: ["doe2024"],
            figureIds: ["fig-pipeline"],
          },
          {
            id: "methods-p2",
            text: "The article also includes a plain paragraph without references.",
            citations: [],
            figureIds: [],
          },
        ],
      },
    ]);

    expect(result.figures).toEqual([
      {
        id: "fig-pipeline",
        label: "Figure 1.",
        caption: "Figure 1. Pipeline overview rendered by semantic article markup.",
        imageUrl: "https://example.test/assets/pipeline.png",
      },
    ]);
  });

  it("parses common class-based paper sections and lazy-loaded figure variants", () => {
    const html = `
      <html>
        <body>
          <article id="document">
            <section class="paper-section">
              <header>
                <h3>Related Work</h3>
              </header>
              <div class="ltx_para">
                <p>
                  Prior evaluations cite
                  <a href="#bib-ref-1">Lee and Patel</a>
                  before introducing
                  <a href="#S3.F2">Figure 2</a>.
                </p>
              </div>
            </section>
            <div id="S3.F2" class="figure">
              <img data-src="//cdn.example.test/figures/lazy-result.webp" alt="results" />
              <div class="figure-caption">
                <span class="figure-label">Figure 2</span>
                Accuracy curves from a lazy-loaded figure.
              </div>
            </div>
          </article>
        </body>
      </html>
    `;

    const result = parseAr5ivHtml(html, {
      imageBaseUrl: "https://example.test/papers/structured/",
    });

    expect(result.sections).toEqual([
      {
        id: "section-1",
        title: "Related Work",
        level: 3,
        paragraphs: [
          {
            id: "section-1-p1",
            text: "Prior evaluations cite Lee and Patel before introducing Figure 2.",
            citations: ["bib-ref-1"],
            figureIds: ["S3.F2"],
          },
        ],
      },
    ]);

    expect(result.figures).toEqual([
      {
        id: "S3.F2",
        label: "Figure 2",
        caption: "Figure 2 Accuracy curves from a lazy-loaded figure.",
        imageUrl: "https://cdn.example.test/figures/lazy-result.webp",
      },
    ]);
  });

  it("extracts bibliography entries with enrichable identities", () => {
    const html = `
      <article id="ltx_document">
        <section id="S1" class="ltx_section">
          <h2 class="ltx_title ltx_title_section">1 Introduction</h2>
          <div class="ltx_para"><p class="ltx_p">
            Attention was introduced by <a class="ltx_ref" href="#bib.bib2">Bahdanau et al.</a>.
          </p></div>
        </section>
        <section id="bib" class="ltx_bibliography">
          <h2 class="ltx_title ltx_title_bibliography">References</h2>
          <ul class="ltx_biblist">
            <li id="bib.bib1" class="ltx_bibitem">
              <span class="ltx_tag ltx_tag_bibitem">[1]</span>
              <span class="ltx_bibblock">J. Ba, J. Kiros, and G. Hinton.</span>
              <span class="ltx_bibblock">Layer normalization.</span>
              <span class="ltx_bibblock">
                <em>arXiv preprint arXiv:1607.06450</em>, 2016.
              </span>
            </li>
            <li id="bib.bib2" class="ltx_bibitem">
              <span class="ltx_tag ltx_tag_bibitem">[2]</span>
              <span class="ltx_bibblock">D. Bahdanau, K. Cho, and Y. Bengio.</span>
              <span class="ltx_bibblock">Neural machine translation by jointly learning to align and translate.</span>
              <span class="ltx_bibblock">
                In <em>ICLR</em>, 2015.
                <a href="https://arxiv.org/abs/1409.0473" class="ltx_ref">arXiv</a>
              </span>
            </li>
            <li id="bib.bib3" class="ltx_bibitem">
              <span class="ltx_tag ltx_tag_bibitem">[3]</span>
              <span class="ltx_bibblock">A. Doe.</span>
              <span class="ltx_bibblock">A DOI-only venue paper.</span>
              <span class="ltx_bibblock">
                <a href="https://doi.org/10.1000/xyz123" class="ltx_ref">doi</a>, 2019.
              </span>
            </li>
          </ul>
        </section>
      </article>
    `;

    const result = parseAr5ivHtml(html);

    expect(result.references).toHaveLength(3);

    const [ba, bahdanau, doe] = result.references;

    expect(ba.id).toBe("bib.bib1");
    expect(ba.title).toBe("Layer normalization");
    expect(ba.authors).toEqual(["J. Ba", "J. Kiros", "G. Hinton"]);
    expect(ba.year).toBe(2016);
    // Text-form "arXiv:1607.06450" is picked up even without a link.
    expect(ba.arxivId).toBe("1607.06450");
    expect(ba.url).toBe("https://arxiv.org/abs/1607.06450");

    expect(bahdanau.id).toBe("bib.bib2");
    expect(bahdanau.title).toBe(
      "Neural machine translation by jointly learning to align and translate",
    );
    expect(bahdanau.arxivId).toBe("1409.0473");
    expect(bahdanau.year).toBe(2015);
    expect(bahdanau.url).toBe("https://arxiv.org/abs/1409.0473");

    expect(doe.id).toBe("bib.bib3");
    expect(doe.doi).toBe("10.1000/xyz123");
    expect(doe.arxivId).toBeUndefined();

    // Paragraph citation anchors line up with bibliography ids.
    expect(result.sections[0].paragraphs[0].citations).toEqual(["bib.bib2"]);
    // The bibliography section itself is not extracted as a content section.
    expect(result.sections.map((section) => section.id)).toEqual(["S1"]);
  });

  it("returns an empty reference list when there is no bibliography", () => {
    const html = `
      <article>
        <section id="S1"><h2>Intro</h2><p>Text.</p></section>
      </article>
    `;

    expect(parseAr5ivHtml(html).references).toEqual([]);
  });

  it("does not duplicate the paper path for root-relative image URLs", () => {
    const html = `
      <article>
        <section id="S1">
          <h2>Intro</h2>
          <p>Root-relative image paths appear in some ar5iv pages.</p>
        </section>
        <figure id="S1.F1">
          <img src="/html/2401.01234/assets/Figures/overview.png" />
          <figcaption>Figure 1: Overview.</figcaption>
        </figure>
      </article>
    `;

    const result = parseAr5ivHtml(html, {
      imageBaseUrl: "https://ar5iv.org/html/2401.01234",
    });

    expect(result.figures[0]?.imageUrl).toBe(
      "https://ar5iv.org/html/2401.01234/assets/Figures/overview.png",
    );
  });
});
