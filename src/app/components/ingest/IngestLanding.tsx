"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

interface UploadPreview {
  fileName: string;
  pageCount: number;
  method: string;
  textLength: number;
}

type IngestStatus =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "success"; paperId: string }
  | { state: "error"; message: string };

type UploadStatus =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "success"; preview: UploadPreview }
  | { state: "error"; message: string };

const normalizeArxivId = (input: string): string | null => {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  const lower = trimmed.toLowerCase();

  if (lower.startsWith("arxiv:")) {
    return trimmed.slice(6);
  }

  const urlMatch = trimmed.match(
    /arxiv\.org\/(?:abs|pdf)\/([\w.\-\/]+?)(?:v\d+)?(?:\.pdf)?(?:[#?].*)?$/i,
  );
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  const idMatch = trimmed.match(
    /^((?:\d{4}\.\d{4,5})|(?:[a-z\-]+\/\d{7}))(?:v\d+)?$/i,
  );
  if (idMatch?.[1]) {
    return idMatch[1];
  }

  return null;
};

const IngestLanding = () => {
  const router = useRouter();
  const [arxivInput, setArxivInput] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [forceOcr, setForceOcr] = useState(false);
  const [status, setStatus] = useState<IngestStatus>({ state: "idle" });
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>({
    state: "idle",
  });

  const normalizedId = useMemo(
    () => normalizeArxivId(arxivInput),
    [arxivInput],
  );

  const ingestDisabled =
    !normalizedId || status.state === "submitting" || uploadStatus.state === "uploading";

  const handleIngest = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!normalizedId) {
        setStatus({
          state: "error",
          message: "Enter a valid arXiv identifier or URL.",
        });
        return;
      }

      setStatus({ state: "submitting" });

      try {
        const response = await fetch("/api/ingest", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            arxivId: normalizedId,
            contactEmail: contactEmail.trim() || undefined,
            forceOcr,
          }),
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          const errorMessage =
            payload?.error ??
            `Ingestion failed with status ${response.status}.`;
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as { paperId: string };
        setStatus({ state: "success", paperId: result.paperId });

        setTimeout(() => {
          router.push(`/papers/${encodeURIComponent(result.paperId)}`);
        }, 900);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Unexpected ingestion error occurred.";
        setStatus({ state: "error", message });
      }
    },
    [contactEmail, forceOcr, normalizedId, router],
  );

  const handlePdfUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }

      setUploadStatus({ state: "uploading" });

      const formData = new FormData();
      formData.append("pdf", file, file.name);

      try {
        const response = await fetch("/api/extract-research-paper", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          const errorMessage =
            payload?.error ??
            `Extraction failed with status ${response.status}.`;
          throw new Error(errorMessage);
        }

        const result = (await response.json()) as {
          method: string;
          stats: { pages: number; combinedTextLength: number };
        };

        setUploadStatus({
          state: "success",
          preview: {
            fileName: file.name,
            method: result.method,
            pageCount: result.stats.pages,
            textLength: result.stats.combinedTextLength,
          },
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to analyse PDF.";
        setUploadStatus({ state: "error", message });
      }
    },
    [],
  );

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 text-white">
      <header className="mx-auto w-full max-w-5xl px-6 pb-10 pt-16 text-center sm:pb-14">
        <p className="text-sm uppercase tracking-[0.25em] text-zinc-400">
          Readable · Research companion
        </p>
        <h1 className="mt-6 text-4xl font-semibold leading-tight sm:text-5xl">
          Upload a paper to start your personalized summary
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-zinc-300 sm:text-lg">
          Drop a PDF or paste an arXiv link. We’ll ingest the document, extract
          figures, and stream you into the workspace with summaries, Q&amp;A,
          and persona-aware prompts.
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 pb-16">
        <section className="grid gap-6 lg:grid-cols-2">
          <form
            onSubmit={handleIngest}
            className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-6 shadow-xl backdrop-blur"
          >
            <h2 className="text-lg font-semibold text-white">
              Paste arXiv ID or URL
            </h2>
            <p className="text-sm text-zinc-300">
              We’ll fetch metadata, sections, and figures. Processing takes ~20–40s.
            </p>
            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-zinc-200">ArXiv link or ID</span>
              <input
                type="text"
                placeholder="e.g., https://arxiv.org/abs/1706.03762"
                value={arxivInput}
                onChange={(event) => setArxivInput(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-white placeholder:text-zinc-400 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </label>

            <label className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-zinc-200">
                Contact email (optional)
              </span>
              <input
                type="email"
                placeholder="You’ll receive ingest notices here"
                value={contactEmail}
                onChange={(event) => setContactEmail(event.target.value)}
                className="rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-white placeholder:text-zinc-400 focus:border-white/30 focus:outline-none focus:ring-2 focus:ring-white/20"
              />
            </label>

            <label className="flex items-center gap-3 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={forceOcr}
                onChange={(event) => setForceOcr(event.target.checked)}
                className="h-4 w-4 rounded border-white/20 bg-zinc-800 text-zinc-200 focus:ring-white/30"
              />
              Force OCR fallback (useful for scanned PDFs)
            </label>

            <button
              type="submit"
              disabled={ingestDisabled}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-3 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:pointer-events-none disabled:opacity-40"
            >
              {status.state === "submitting"
                ? "Ingesting…"
                : "Ingest arXiv paper"}
            </button>

            {status.state === "error" && (
              <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {status.message}
              </div>
            )}

            {status.state === "success" && (
              <div className="rounded-lg border border-emerald-400/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                Paper queued successfully — redirecting to workspace…
              </div>
            )}
          </form>

          <div className="flex flex-col gap-4 rounded-3xl border border-white/10 bg-zinc-950/40 p-6 shadow-xl backdrop-blur">
            <h2 className="text-lg font-semibold text-white">
              Or upload a local PDF
            </h2>
            <p className="text-sm text-zinc-300">
              We’ll auto-detect whether OCR is required and show a quick preview.
              Full ingest support for arbitrary PDFs is coming soon.
            </p>

            <label className="relative flex flex-1 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-white/20 bg-white/5 px-6 py-12 text-center text-sm text-zinc-300 transition hover:border-white/40 hover:bg-white/10">
              <input
                type="file"
                accept="application/pdf"
                className="sr-only"
                onChange={handlePdfUpload}
              />
              <span className="text-base font-semibold text-white">
                Drag & drop PDF
              </span>
              <span>…or click to browse files</span>
            </label>

            {uploadStatus.state === "uploading" && (
              <div className="rounded-lg border border-white/10 bg-white/10 px-4 py-3 text-sm text-zinc-200">
                Analysing PDF…
              </div>
            )}

            {uploadStatus.state === "error" && (
              <div className="rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {uploadStatus.message}
              </div>
            )}

            {uploadStatus.state === "success" && (
              <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm text-zinc-200">
                <div className="text-sm font-medium text-white">
                  {uploadStatus.preview.fileName}
                </div>
                <div className="text-xs uppercase tracking-wide text-zinc-400">
                  {uploadStatus.preview.pageCount} pages · method{" "}
                  {uploadStatus.preview.method}
                </div>
                <p className="text-xs text-zinc-400">
                  Extracted {uploadStatus.preview.textLength.toLocaleString()}{" "}
                  characters. PDF uploads will soon route into the full workspace
                  pipeline.
                </p>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-white/80 transition hover:border-white/40 hover:text-white"
                  onClick={() => router.push("/papers/arxiv:1706.03762")}
                >
                  Explore demo workspace
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
          <h2 className="text-base font-semibold text-white">
            What happens next?
          </h2>
          <ul className="mt-4 space-y-3 text-sm text-zinc-300">
            <li>
              <span className="font-medium text-white">1.</span> Fetch metadata,
              HTML, PDF, and TEI artefacts for section-aware parsing.
            </li>
            <li>
              <span className="font-medium text-white">2.</span> Chunk the paper,
              capture figures/citations, and upsert into Weaviate for retrieval.
            </li>
            <li>
              <span className="font-medium text-white">3.</span> Redirect you to
              the reader workspace where summaries, figures, and chat await.
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
};

export default IngestLanding;
