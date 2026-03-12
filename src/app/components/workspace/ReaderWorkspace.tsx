"use client";

import { useEffect, useState } from "react";
import { SunMedium, MoonStar } from "lucide-react";
import { useTheme } from "next-themes";

import { BlockEditor } from "../block-editor/BlockEditor";
import PdfPanel from "./PdfPanel";
import { usePaperContent } from "./usePaperContent";
import { useWorkspaceStatus } from "./useWorkspaceStatus";

export interface ReaderWorkspaceProps {
  paperId?: string;
  pdfUrl?: string;
}

const ReaderWorkspace = ({ paperId, pdfUrl }: ReaderWorkspaceProps) => {
  const { setTheme, resolvedTheme } = useTheme();
  const [personaEnabled, setPersonaEnabled] = useState(false);

  const {
    resolvedPaperId,
    resolvedPdfUrl,
    summary,
    summaryError,
    arxivHtmlContent,
    initialBlocks,
    htmlError,
  } = usePaperContent({ paperId, pdfUrl });

  const { statusMessage, setStatusMessage, clearStatus } = useWorkspaceStatus();

  useEffect(() => {
    if (arxivHtmlContent) {
      setStatusMessage((previous) => previous ?? "Paper content loaded from HTML.");
    }
  }, [arxivHtmlContent, setStatusMessage]);

  useEffect(() => {
    if (summary) {
      setStatusMessage((previous) => previous ?? "Summary refreshed from the latest ingest.");
    }
  }, [summary, setStatusMessage]);

  useEffect(() => {
    if (summaryError || htmlError) {
      setStatusMessage((previous) => previous ?? summaryError ?? htmlError ?? null);
    }
  }, [htmlError, setStatusMessage, summaryError]);

  const isDarkMode = resolvedTheme === "dark";

  return (
    <div
      className={`flex min-h-screen flex-col font-sans ${
        isDarkMode ? "bg-neutral-950 text-neutral-100" : "bg-zinc-50 text-zinc-900"
      }`}
    >
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-5 py-10">
        <BlockEditor
          paperId={resolvedPaperId}
          initialBlocks={initialBlocks}
          statusMessage={statusMessage}
          errorMessage={summaryError}
          onStatusClear={clearStatus}
          showChatButton={true}
          personaEnabled={personaEnabled}
          onPersonaToggle={setPersonaEnabled}
        />
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setTheme(isDarkMode ? "light" : "dark")}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition ${
              isDarkMode
                ? "border-neutral-700 bg-neutral-900 text-neutral-200 hover:bg-neutral-800"
                : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100"
            }`}
            title={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDarkMode ? "Switch to light mode" : "Switch to dark mode"}
          >
            {isDarkMode ? <SunMedium className="h-4 w-4" /> : <MoonStar className="h-4 w-4" />}
          </button>
          <PdfPanel
            pdfUrl={resolvedPdfUrl}
            summary={summary}
            arxivHtmlContent={arxivHtmlContent}
            isDarkMode={isDarkMode}
            onStatus={setStatusMessage}
          />
        </div>
      </main>
    </div>
  );
};

export default ReaderWorkspace;
