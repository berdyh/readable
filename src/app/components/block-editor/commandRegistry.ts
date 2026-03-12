export type SlashCommandCategory = "text" | "research" | "content";

export type SlashCommandId =
  | "heading1"
  | "heading2"
  | "heading3"
  | "bullet"
  | "number"
  | "todo"
  | "code"
  | "quote"
  | "callout"
  | "summary"
  | "figure"
  | "cite"
  | "arxiv"
  | "explain"
  | "compare"
  | "chat"
  | "divider";

export type ApiCommandId =
  | "summary"
  | "figure"
  | "citation"
  | "explain"
  | "compare"
  | "eli5"
  | "arxiv";

export interface SlashCommandRegistryItem {
  id: SlashCommandId;
  title: string;
  description: string;
  icon: string;
  category: SlashCommandCategory;
  keywords?: string[];
  backendCommand?: ApiCommandId;
}

export const SLASH_COMMAND_REGISTRY: SlashCommandRegistryItem[] = [
  {
    id: "heading1",
    title: "Heading 1",
    description: "Large section heading",
    icon: "Heading1",
    category: "text",
    keywords: ["h1", "title", "header"],
  },
  {
    id: "heading2",
    title: "Heading 2",
    description: "Medium section heading",
    icon: "Heading2",
    category: "text",
    keywords: ["h2", "subtitle"],
  },
  {
    id: "heading3",
    title: "Heading 3",
    description: "Small section heading",
    icon: "Heading3",
    category: "text",
    keywords: ["h3"],
  },
  {
    id: "bullet",
    title: "Bullet List",
    description: "Create a bulleted list item",
    icon: "List",
    category: "text",
    keywords: ["ul", "unordered", "bullet"],
  },
  {
    id: "number",
    title: "Numbered List",
    description: "Create a numbered list item",
    icon: "ListOrdered",
    category: "text",
    keywords: ["ol", "ordered", "number"],
  },
  {
    id: "todo",
    title: "To-do",
    description: "Create a to-do list item",
    icon: "CheckSquare",
    category: "text",
    keywords: ["checkbox", "task", "todo"],
  },
  {
    id: "code",
    title: "Code Block",
    description: "Insert a code block",
    icon: "Code",
    category: "text",
    keywords: ["code", "snippet"],
  },
  {
    id: "quote",
    title: "Quote",
    description: "Insert a quote block",
    icon: "Quote",
    category: "text",
    keywords: ["quote", "citation"],
  },
  {
    id: "callout",
    title: "Callout",
    description: "Insert a callout block",
    icon: "Sparkles",
    category: "text",
    keywords: ["callout", "note", "info"],
  },
  {
    id: "summary",
    title: "Summary",
    description: "Generate summary for selected text or paper",
    icon: "Sparkles",
    category: "research",
    keywords: ["summarize", "abstract"],
    backendCommand: "summary",
  },
  {
    id: "figure",
    title: "Insert Figure",
    description: "Fetch and insert nearby figures from the paper",
    icon: "Image",
    category: "research",
    keywords: ["fig", "image", "diagram"],
    backendCommand: "figure",
  },
  {
    id: "cite",
    title: "Citations",
    description: "Insert citations referenced in this section",
    icon: "Quote",
    category: "research",
    keywords: ["citation", "reference", "cite"],
    backendCommand: "citation",
  },
  {
    id: "arxiv",
    title: "Insert from arXiv",
    description: "Pull sections and figures from an arXiv paper",
    icon: "Globe",
    category: "research",
    keywords: ["arxiv", "paper", "import"],
    backendCommand: "arxiv",
  },
  {
    id: "explain",
    title: "Explain",
    description: "Get explanation of selected text",
    icon: "Sparkles",
    category: "research",
    keywords: ["explain", "clarify", "what"],
    backendCommand: "explain",
  },
  {
    id: "compare",
    title: "Compare",
    description: "Compare with related work or concepts",
    icon: "Layers",
    category: "research",
    keywords: ["compare", "vs", "versus"],
    backendCommand: "compare",
  },
  {
    id: "chat",
    title: "AI Chat",
    description: "Insert inline chat assistant",
    icon: "MessageSquare",
    category: "research",
    keywords: ["chat", "ai", "assistant", "help"],
  },
  {
    id: "divider",
    title: "Divider",
    description: "Insert a horizontal divider",
    icon: "CircleDashed",
    category: "content",
    keywords: ["hr", "line", "separator"],
  },
];

const SLASH_COMMAND_LOOKUP = new Map<SlashCommandId, SlashCommandRegistryItem>(
  SLASH_COMMAND_REGISTRY.map((command) => [command.id, command]),
);

export function getSlashCommandById(id: SlashCommandId): SlashCommandRegistryItem | undefined {
  return SLASH_COMMAND_LOOKUP.get(id);
}
