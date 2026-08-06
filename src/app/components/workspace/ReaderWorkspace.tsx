"use client";

import { useEffect, useMemo, useState } from "react";
import { SignInButton, SignUpButton } from "@clerk/nextjs";
import { clsx } from "clsx";
import { SunMedium, MoonStar } from "lucide-react";
import { useTheme } from "next-themes";

import { BlockEditor } from "../block-editor/BlockEditor";
import PdfPanel from "./pdf/PdfPanel";
import { SkillsPanel } from "./SkillsPanel";
import { ThreePassBar } from "./ThreePassBar";
import { resolvePaperId, usePaperContent } from "./usePaperContent";
import { usePassState } from "./usePassState";
import { useWorkspaceStatus } from "./useWorkspaceStatus";

export interface ReaderWorkspaceProps {
  paperId?: string;
  pdfUrl?: string;
}

const PERSONALIZED_FEATURES_AUTH_MESSAGE = "Sign in to use personalized reading features.";

const ReaderWorkspace = ({ paperId, pdfUrl }: ReaderWorkspaceProps) => {
  // resolvedTheme is undefined on the server but populated post-mount.
  // Tailwind `dark:` utilities (driven by next-themes' class on <html>)
  // handle all theming, so resolvedTheme is only read inside the toggle's
  // click handler — which cannot run before mount — and never during render.
  const { setTheme, resolvedTheme } = useTheme();
  const [isResearchChatOpen, setIsResearchChatOpen] = useState(false);

  // Pass state first: the pass decides whether the explanation contract
  // (pass 1) or the paper HTML (passes 2–3) is the primary reading
  // surface. Same id resolution as usePaperContent so the persisted
  // pass keeps its per-paper key.
  const { pass, setPass } = usePassState({ paperId: resolvePaperId(paperId) });

  const {
    resolvedPaperId,
    resolvedPdfUrl,
    summary,
    summaryError,
    arxivHtmlContent,
    initialBlocks,
    documentKey,
    htmlError,
  } = usePaperContent({ paperId, pdfUrl, pass });

  const { statusMessage, setStatusMessage, clearStatus } = useWorkspaceStatus();
  const showPersonalizedFeatureGate = summaryError === PERSONALIZED_FEATURES_AUTH_MESSAGE;
  const editorInitialBlocks = useMemo(() => {
    if (!showPersonalizedFeatureGate) {
      return initialBlocks;
    }

    return initialBlocks.map((block) => {
      if (
        block.id === "error-placeholder" &&
        block.content.includes(PERSONALIZED_FEATURES_AUTH_MESSAGE)
      ) {
        return {
          ...block,
          content:
            "Sign in to generate a personalized summary for this paper. Public paper text will appear here when HTML parsing is available.",
        };
      }

      return block;
    });
  }, [initialBlocks, showPersonalizedFeatureGate]);

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
    const summaryStatus = showPersonalizedFeatureGate ? null : summaryError;
    if (summaryStatus || htmlError) {
      setStatusMessage((previous) => previous ?? summaryStatus ?? htmlError ?? null);
    }
  }, [htmlError, setStatusMessage, showPersonalizedFeatureGate, summaryError]);

  return (
    <div className="flex min-h-screen flex-col bg-zinc-50 font-sans text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <div
        className={clsx(
          // No pt-20 here any more. It existed only to clear the account chip
          // that the root layout used to position `fixed` over every route;
          // the chip now sits in normal flow, so the reader no longer has to
          // know about it.
          "mx-auto flex w-full flex-1 flex-col px-5 pb-10 pt-2 transition-[max-width] duration-200 ease-out motion-reduce:transition-none",
          isResearchChatOpen ? "max-w-7xl" : "max-w-6xl",
        )}
      >
        <div className="flex flex-col gap-6 lg:flex-row">
          <div className="flex-1 min-w-0">
            {showPersonalizedFeatureGate && (
              <section
                aria-label="Personalized reader features"
                className="mb-4 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/30 dark:text-amber-100 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">Sign in for personalized reading tools.</p>
                  <p className="mt-1 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
                    Public paper text stays readable; summaries, saved chats, and skills need an
                    account.
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <SignInButton>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg bg-zinc-950 px-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      Sign in
                    </button>
                  </SignInButton>
                  <SignUpButton>
                    <button
                      type="button"
                      className="inline-flex h-9 items-center justify-center rounded-lg border border-amber-300 px-3 text-sm font-medium text-amber-900 transition hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900/40"
                    >
                      Sign up
                    </button>
                  </SignUpButton>
                </div>
              </section>
            )}
            <ThreePassBar pass={pass} onPassChange={setPass} />
            <BlockEditor
              paperId={resolvedPaperId}
              initialBlocks={editorInitialBlocks}
              documentKey={documentKey}
              statusMessage={statusMessage}
              errorMessage={showPersonalizedFeatureGate ? null : summaryError}
              onStatusClear={clearStatus}
              showChatButton={true}
              onChatOpenChange={setIsResearchChatOpen}
            />
          </div>
          {!isResearchChatOpen && (
            <div className="hidden lg:block">
              <SkillsPanel />
            </div>
          )}
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
            className="touch-target relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-zinc-300 bg-white text-zinc-600 shadow-sm transition-colors duration-150 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
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
            onStatus={setStatusMessage}
          />
        </div>
      </div>
    </div>
  );
};

export default ReaderWorkspace;
