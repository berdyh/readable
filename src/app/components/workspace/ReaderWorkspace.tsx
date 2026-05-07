"use client";

import { useEffect, useState } from "react";
import { SunMedium, MoonStar } from "lucide-react";
import { useTheme } from "next-themes";

import { BlockEditor } from "../block-editor/BlockEditor";
import PdfPanel from "./PdfPanel";
import { SkillsPanel } from "./SkillsPanel";
import { ThreePassBar } from "./ThreePassBar";
import { usePaperContent } from "./usePaperContent";
import { usePassState } from "./usePassState";
import { useWorkspaceStatus } from "./useWorkspaceStatus";

const SKILLS_USER_ID = "demo-user";

export interface ReaderWorkspaceProps {
  paperId?: string;
  pdfUrl?: string;
}

const ReaderWorkspace = ({ paperId, pdfUrl }: ReaderWorkspaceProps) => {
  // resolvedTheme is undefined on the server but populated post-mount.
  // Tailwind `dark:` utilities (driven by next-themes' class on <html>)
  // handle the actual theming, so we only consult resolvedTheme for the
  // theme-switch toggle (which is only operable after mount anyway) and
  // for the legacy isDarkMode prop on PdfPanel.
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

  const { pass, setPass } = usePassState({ paperId: resolvedPaperId });

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
    <div className="flex min-h-screen flex-col font-sans bg-zinc-50 text-zinc-900 dark:bg-neutral-950 dark:text-neutral-100">
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 py-10">
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 min-w-0">
            <ThreePassBar pass={pass} onPassChange={setPass} />
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
          </div>
          <div className="hidden lg:block">
            <SkillsPanel userId={SKILLS_USER_ID} />
          </div>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() =>
              setTheme(resolvedTheme === "dark" ? "light" : "dark")
            }
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border shadow-sm transition border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
            title="Toggle theme"
            aria-label="Toggle theme"
          >
            {/* CSS-toggled icon — both ship in markup, only one paints
                per dark variant, so server + client render identical
                strings and never trigger a hydration mismatch. */}
            <SunMedium className="h-4 w-4 hidden dark:inline" aria-hidden="true" />
            <MoonStar className="h-4 w-4 inline dark:hidden" aria-hidden="true" />
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
