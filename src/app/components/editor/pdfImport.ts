"use client";

import type { TextItem } from "pdfjs-dist/types/src/display/api";

const WORKER_SRC =
  "https://unpkg.com/pdfjs-dist@5.4.296/build/pdf.worker.min.js";

type PdfJsModule = typeof import("pdfjs-dist");

let pdfModulePromise: Promise<PdfJsModule> | null = null;

async function loadPdfModule(): Promise<PdfJsModule> {
  if (!pdfModulePromise) {
    pdfModulePromise = import("pdfjs-dist").then((module) => {
      module.GlobalWorkerOptions.workerSrc = WORKER_SRC;
      return module;
    });
  }
  return pdfModulePromise;
}

function normalizeText(items: TextItem[]): string {
  const parts: string[] = [];

  for (const item of items) {
    if (!item.str) {
      continue;
    }
    parts.push(item.str);
    parts.push(item.hasEOL ? "\n" : " ");
  }

  return parts
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/\t+/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ImportedPdfPage {
  pageNumber: number;
  text: string;
  imageDataUrl?: string;
}

interface ImportPdfOptions {
  maxPages?: number;
  scale?: number;
}

export async function importPdfDocument(
  url: string,
  options: ImportPdfOptions = {},
): Promise<ImportedPdfPage[]> {
  if (typeof window === "undefined") {
    throw new Error("PDF import is only available in the browser.");
  }

  const pdfjs = await loadPdfModule();
  const loadingTask = pdfjs.getDocument({
    url,
    withCredentials: false,
  });
  const document = await loadingTask.promise;

  const maxPages = options.maxPages ?? 3;
  const scale = options.scale ?? 1.4;
  const pages: ImportedPdfPage[] = [];

  try {
    for (
      let pageNumber = 1;
      pageNumber <= document.numPages && pageNumber <= maxPages;
      pageNumber += 1
    ) {
      const page = await document.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = normalizeText(
        textContent.items.filter((item): item is TextItem =>
          Boolean((item as TextItem).str),
        ),
      );

      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      const context = canvas.getContext("2d");

      if (!context) {
        throw new Error("Unable to render PDF page.");
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
      });
      await renderTask.promise;

      const imageDataUrl = canvas.toDataURL("image/png");
      pages.push({
        pageNumber,
        text,
        imageDataUrl,
      });
    }
  } finally {
    await document.destroy();
    await loadingTask.destroy();
  }

  return pages;
}
