import type { ResearchEditorCommands } from "./useResearchCommands";

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  run: () => void;
}

export function buildSlashCommandItems(
  actions: ResearchEditorCommands,
): SlashCommandItem[] {
  return [
    {
      id: "summary",
      title: "Summary",
      description: "Insert a quick callout for the highlighted passage.",
      icon: "Sparkles",
      run: () => {
        void actions.summarizeSelection();
      },
    },
    {
      id: "deeper",
      title: "Deeper dive",
      description: "Expand the most recent callout’s hidden context.",
      icon: "Layers",
      run: actions.expandCallout,
    },
    {
      id: "figures",
      title: "Figures",
      description: "Fetch nearby figures and drop them inline.",
      icon: "Image",
      run: () => {
        void actions.insertFigures();
      },
    },
    {
      id: "cite",
      title: "Citations",
      description: "Insert the citations referenced by this snippet.",
      icon: "Quote",
      run: () => {
        void actions.insertCitations();
      },
    },
    {
      id: "insert-pdf",
      title: "Insert PDF",
      description: "Import pages and figures from a PDF URL.",
      icon: "FileText",
      run: () => {
        void actions.insertPdf();
      },
    },
    {
      id: "insert-arxiv",
      title: "Insert arXiv",
      description: "Pull sections + figures directly from arXiv.",
      icon: "Globe",
      run: () => {
        void actions.insertArxiv();
      },
    },
  ];
}
