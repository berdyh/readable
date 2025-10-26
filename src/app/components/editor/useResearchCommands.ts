"use client";

import {
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Editor } from "@tiptap/react";

import type {
  InlineArxivIngestResult,
  SelectionCalloutResult,
  SelectionCitationsResult,
  SelectionFiguresResult,
} from "@/server/editor/types";
import type { AnswerCitation } from "@/server/qa/types";

import { importPdfDocument } from "./pdfImport";

interface CommandContext {
  editor: Editor | null;
  paperId?: string;
}

interface SelectionPayload {
  text: string;
  from: number;
  to: number;
}

interface CommandState {
  status: string | null;
  error: string | null;
  isRunning: boolean;
}

export interface ResearchEditorCommands extends CommandState {
  summarizeSelection: () => Promise<void>;
  expandCallout: () => void;
  insertFigures: () => Promise<void>;
  insertCitations: () => Promise<void>;
  insertArxiv: (target?: string) => Promise<void>;
  insertPdf: (url?: string) => Promise<void>;
  clearStatus: () => void;
}

const CALL_OUT_LIMIT = 8;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatCitation(citation: AnswerCitation): string {
  if (citation.page) {
    return `page ${citation.page}`;
  }
  return citation.chunkId;
}

function buildCalloutHtml(
  callout: SelectionCalloutResult,
  calloutId: string,
  options?: { openDetails?: boolean },
): string {
  const { openDetails } = options ?? {};
  const bulletItems = callout.bullets
    .map((bullet) => {
      const sources = bullet.citationIds
        .map((id) => callout.citations.find((cite) => cite.chunkId === id))
        .filter(Boolean)
        .map(
          (citation) =>
            `<span class="notebook-callout__source" data-source="${citation?.chunkId ?? ""}">${escapeHtml(
              formatCitation(citation!),
            )}</span>`,
        )
        .join("");

      return `<li><span>${escapeHtml(bullet.text)}</span>${
        sources ? `<span class="notebook-callout__sources-list">${sources}</span>` : ""
      }</li>`;
    })
    .join("");

  const deeperHtml = callout.deeper
    .map((entry) => `<p>${escapeHtml(entry)}</p>`)
    .join("");

  const footerSources = callout.citations
    .map(
      (citation) =>
        `<span class="notebook-callout__source" data-source="${citation.chunkId}">${escapeHtml(
          formatCitation(citation),
        )}</span>`,
    )
    .join("");

  return `
<section class="notebook-callout" data-callout-id="${calloutId}">
  <header class="notebook-callout__heading">
    <span>Quick summary</span>
  </header>
  <ul class="notebook-callout__bullets">
    ${bulletItems}
  </ul>
  ${
    deeperHtml
      ? `<details class="notebook-callout__details" data-callout-details="${calloutId}"${
          openDetails ? " open" : ""
        }>
      <summary>More…</summary>
      <div>${deeperHtml}</div>
    </details>`
      : ""
  }
  ${
    footerSources
      ? `<footer class="notebook-callout__footer">Sources: ${footerSources}</footer>`
      : ""
  }
</section>`;
}

function buildFiguresHtml(
  figures: SelectionFiguresResult["figures"],
): string {
  if (!figures.length) {
    return `<div class="notebook-soft-error">No associated figures were found near this selection.</div>`;
  }

  return figures
    .map((figure, index) => {
      const imageMarkup = figure.imageUrl
        ? `<img src="${figure.imageUrl}" alt="${escapeHtml(
            figure.figureId,
          )}" loading="lazy" />`
        : `<div class="notebook-figure__placeholder">Image unavailable for ${figure.figureId}</div>`;
      const caption = escapeHtml(figure.caption);
      const meta = figure.pageNumber
        ? `<small>page ${figure.pageNumber}</small>`
        : "";
      return `${index > 0 ? '<hr class="notebook-divider" />' : ""}
<figure class="notebook-figure" data-figure-id="${figure.figureId}">
  ${imageMarkup}
  <figcaption>${caption} ${meta}</figcaption>
</figure>`;
    })
    .join("");
}

function createSoftErrorHtml(message: string): string {
  return `<div class="notebook-soft-error">${escapeHtml(message)}</div>`;
}

function normalizeSelectionKey(text: string): string {
  return text.trim().toLowerCase().slice(0, 320);
}

function buildArxivImportHtml(result: InlineArxivIngestResult): string {
  const metaParts: string[] = [];
  if (result.title) {
    metaParts.push(`<strong>${escapeHtml(result.title)}</strong>`);
  }
  if (result.authors?.length) {
    metaParts.push(escapeHtml(result.authors.join(", ")));
  }
  const header = metaParts.length
    ? `<div class="notebook-import__meta">${metaParts.join(" · ")}</div>`
    : "";

  const sectionsHtml = result.sections
    .map((section, index) => {
      const headingLevel = Math.min(section.level + 1, 4);
      const headingTag = `h${headingLevel}`;
      const paragraphs = section.paragraphs
        .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
        .join("");
      const divider =
        index === 0 ? "" : '<hr class="notebook-divider" aria-hidden="true" />';
      return `${divider}<${headingTag}>${escapeHtml(section.title)}</${headingTag}>${paragraphs}`;
    })
    .join("");

  const figuresHtml = result.figures.length
    ? `<hr class="notebook-divider" aria-hidden="true" />
    <div class="notebook-import__figure-grid">
      ${result.figures
        .map((figure) => {
          const image = figure.imageUrl
            ? `<img src="${figure.imageUrl}" loading="lazy" alt="${escapeHtml(
                figure.label ?? figure.id,
              )}" />`
            : `<div class="notebook-figure__placeholder">Image unavailable for ${
                figure.label ?? figure.id
              }</div>`;
          return `<figure>${image}<figcaption>${escapeHtml(figure.caption)}</figcaption></figure>`;
        })
        .join("")}
    </div>`
    : "";

  return `
<section class="notebook-import">
  <div class="notebook-import__eyebrow">
    Imported from <a href="${result.sourceUrl}" target="_blank" rel="noreferrer">arXiv:${escapeHtml(
      result.arxivId,
    )}</a>
  </div>
  ${header}
  ${sectionsHtml}
  ${figuresHtml}
</section>
`;
}

export function useResearchCommands({
  editor,
  paperId,
}: CommandContext): ResearchEditorCommands {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const calloutLookupRef = useRef<Map<string, string>>(new Map());
  const lastCalloutIdRef = useRef<string | null>(null);

  const getSelection = useCallback((): SelectionPayload | null => {
    if (!editor) {
      return null;
    }
    const { state } = editor;
    const { from, to } = state.selection;
    if (from === to) {
      return null;
    }
    const text = state.doc.textBetween(from, to, " ").trim();
    if (!text) {
      return null;
    }
    return { text, from, to };
  }, [editor]);

  const insertHtmlAfterSelection = useCallback(
    (html: string) => {
      if (!editor) {
        return;
      }
      const { to } = editor.state.selection;
      editor
        .chain()
        .focus()
        .insertContentAt({ from: to, to }, html, {
          updateSelection: false,
        })
        .run();
    },
    [editor],
  );

  const runCommand = useCallback(
    async (label: string, task: () => Promise<void>) => {
      setStatus(label);
      setError(null);
      setIsRunning(true);
      try {
        await task();
        setStatus(`${label} complete`);
      } catch (caught) {
        const message =
          caught instanceof Error
            ? caught.message
            : "Unexpected editor command failure.";
        setError(message);
      } finally {
        setTimeout(() => setStatus(null), 3200);
        setIsRunning(false);
      }
    },
    [],
  );

  const summarizeSelection = useCallback(async () => {
    const selection = getSelection();
    if (!selection || !paperId) {
      setError("Highlight text first to summarize it.");
      return;
    }

    await runCommand("Generating quick summary", async () => {
      const response = await fetch("/api/editor/selection/summary", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          paperId,
          selection: { text: selection.text },
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const message =
          payload?.error ??
          `Summary request failed with status ${response.status}.`;
        insertHtmlAfterSelection(createSoftErrorHtml(message));
        throw new Error(message);
      }

      const result = (await response.json()) as { callout: SelectionCalloutResult };
      const calloutId = `callout-${Math.random().toString(36).slice(2, 10)}`;
      const html = buildCalloutHtml(result.callout, calloutId);
      insertHtmlAfterSelection(html);

      const key = normalizeSelectionKey(selection.text);
      const nextMap = new Map(calloutLookupRef.current);
      nextMap.set(key, calloutId);
      while (nextMap.size > CALL_OUT_LIMIT) {
        const firstKey = nextMap.keys().next().value;
        if (firstKey !== undefined) {
          nextMap.delete(firstKey);
        }
      }
      calloutLookupRef.current = nextMap;
      lastCalloutIdRef.current = calloutId;
    });
  }, [getSelection, insertHtmlAfterSelection, paperId, runCommand]);

  const expandCallout = useCallback(() => {
    const selection = getSelection();
    const key = selection ? normalizeSelectionKey(selection.text) : null;
    const targetId =
      (key ? calloutLookupRef.current.get(key) : null) ??
      lastCalloutIdRef.current;

    if (!targetId) {
      setError("Run a quick summary first to expand its deeper context.");
      return;
    }

    const details = document.querySelector<HTMLElement>(
      `[data-callout-details="${targetId}"]`,
    );
    if (details && "open" in details) {
      (details as HTMLDetailsElement).open = true;
      details.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [getSelection]);

  const insertFigures = useCallback(async () => {
    const selection = getSelection();
    if (!selection || !paperId) {
      setError("Highlight text to fetch related figures.");
      return;
    }

    await runCommand("Fetching figures", async () => {
      const response = await fetch("/api/editor/selection/figures", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId,
          selection: { text: selection.text },
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const message =
          payload?.error ??
          `Figure lookup failed with status ${response.status}.`;
        insertHtmlAfterSelection(createSoftErrorHtml(message));
        throw new Error(message);
      }

      const result = (await response.json()) as SelectionFiguresResult;
      insertHtmlAfterSelection(buildFiguresHtml(result.figures));
    });
  }, [getSelection, insertHtmlAfterSelection, paperId, runCommand]);

  const insertCitations = useCallback(async () => {
    const selection = getSelection();
    if (!selection || !paperId) {
      setError("Highlight text to fetch citations.");
      return;
    }

    await runCommand("Fetching citations", async () => {
      const response = await fetch("/api/editor/selection/citations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId,
          selection: { text: selection.text },
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        const message =
          payload?.error ??
          `Citation lookup failed with status ${response.status}.`;
        insertHtmlAfterSelection(createSoftErrorHtml(message));
        throw new Error(message);
      }

      const result = (await response.json()) as SelectionCitationsResult;

      if (!result.citations.length) {
        insertHtmlAfterSelection(
          `<div class="notebook-soft-error">No citations appeared in this selection.</div>`,
        );
        return;
      }

      const citationItems = result.citations
        .map((citation) => {
          const meta: string[] = [];
          if (citation.source) {
            meta.push(citation.source);
          }
          if (citation.year) {
            meta.push(String(citation.year));
          }
          if (citation.doi) {
            meta.push(`doi:${citation.doi}`);
          }
          const link = citation.url
            ? `<a href="${citation.url}" target="_blank" rel="noreferrer">Link</a>`
            : "";
          return `<li>
            <div class="notebook-citation__title">${escapeHtml(
              citation.title ?? citation.citationId,
            )}</div>
            ${
              meta.length
                ? `<div class="notebook-citation__meta">${escapeHtml(meta.join(" · "))}</div>`
                : ""
            }
            ${link}
          </li>`;
        })
        .join("");

      insertHtmlAfterSelection(`
      <section class="notebook-citation-list">
        <header>Citations</header>
        <ul>${citationItems}</ul>
      </section>`);
    });
  }, [getSelection, insertHtmlAfterSelection, paperId, runCommand]);

  const insertArxiv = useCallback(
    async (target?: string) => {
      const input =
        target ??
        window.prompt("Enter an arXiv ID, DOI, or URL to import inline:");
      if (!input) {
        return;
      }

      await runCommand("Importing from arXiv", async () => {
        const response = await fetch("/api/editor/ingest/arxiv", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: input }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          const message =
            payload?.error ??
            `arXiv ingestion failed with status ${response.status}.`;
          insertHtmlAfterSelection(createSoftErrorHtml(message));
          throw new Error(message);
        }

        const result = (await response.json()) as InlineArxivIngestResult;
        insertHtmlAfterSelection(buildArxivImportHtml(result));
      });
    },
    [insertHtmlAfterSelection, runCommand],
  );

  const insertPdf = useCallback(
    async (url?: string) => {
      const resolvedUrl =
        url ??
        window.prompt("Enter a direct PDF URL to import inline (beta):");
      if (!resolvedUrl) {
        return;
      }

      await runCommand("Importing PDF", async () => {
        const pages = await importPdfDocument(resolvedUrl, { maxPages: 3 });
        if (!pages.length) {
          insertHtmlAfterSelection(
            `<div class="notebook-soft-error">Unable to read that PDF.</div>`,
          );
          return;
        }

        const html = pages
          .map((page, index) => {
            const textParagraphs = page.text
              .split(/\n{2,}/)
              .slice(0, 4)
              .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
              .join("");
            const image = page.imageDataUrl
              ? `<img src="${page.imageDataUrl}" loading="lazy" alt="PDF page ${page.pageNumber}" />`
              : "";
            const divider =
              index === 0
                ? ""
                : '<hr class="notebook-divider" aria-hidden="true" />';
            return `${divider}<section class="notebook-pdf-import">
              <header>PDF page ${page.pageNumber}</header>
              ${image}
              ${textParagraphs}
            </section>`;
          })
          .join("");

        insertHtmlAfterSelection(html);
      });
    },
    [insertHtmlAfterSelection, runCommand],
  );

  const clearStatus = useCallback(() => {
    setStatus(null);
    setError(null);
  }, []);

  return useMemo(
    () => ({
      summarizeSelection,
      expandCallout,
      insertFigures,
      insertCitations,
      insertArxiv,
      insertPdf,
      status,
      error,
      isRunning,
      clearStatus,
    }),
    [
      summarizeSelection,
      expandCallout,
      insertFigures,
      insertCitations,
      insertArxiv,
      insertPdf,
      status,
      error,
      isRunning,
      clearStatus,
    ],
  );
}
