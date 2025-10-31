import type { BlockType } from "./types";

export interface SlashCommandItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  category?: "text" | "research" | "content";
  keywords?: string[];
  run: (context: SlashCommandContext) => void;
}

export interface SlashCommandContext {
  blockId: string;
  blockIndex: number;
  blockType: BlockType;
  currentContent: string;
  paperId?: string;
  onChangeBlockType?: (blockId: string, newType: BlockType) => void;
  onInsertBlock?: (type: BlockType, index: number, content?: string) => void;
  onExecuteApi?: (command: string, params?: Record<string, unknown>) => Promise<void>;
}

// Text formatting commands
export const TEXT_COMMANDS: SlashCommandItem[] = [
  {
    id: "heading1",
    title: "Heading 1",
    description: "Large section heading",
    icon: "Heading1",
    category: "text",
    keywords: ["h1", "title", "header"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "heading_1");
    },
  },
  {
    id: "heading2",
    title: "Heading 2",
    description: "Medium section heading",
    icon: "Heading2",
    category: "text",
    keywords: ["h2", "subtitle"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "heading_2");
    },
  },
  {
    id: "heading3",
    title: "Heading 3",
    description: "Small section heading",
    icon: "Heading3",
    category: "text",
    keywords: ["h3"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "heading_3");
    },
  },
  {
    id: "bullet",
    title: "Bullet List",
    description: "Create a bulleted list item",
    icon: "List",
    category: "text",
    keywords: ["ul", "unordered", "bullet"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "bullet_list");
    },
  },
  {
    id: "number",
    title: "Numbered List",
    description: "Create a numbered list item",
    icon: "ListOrdered",
    category: "text",
    keywords: ["ol", "ordered", "number"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "number_list");
    },
  },
  {
    id: "todo",
    title: "To-do",
    description: "Create a to-do list item",
    icon: "CheckSquare",
    category: "text",
    keywords: ["checkbox", "task", "todo"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "to_do_list");
    },
  },
  {
    id: "code",
    title: "Code Block",
    description: "Insert a code block",
    icon: "Code",
    category: "text",
    keywords: ["code", "snippet"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "code");
    },
  },
  {
    id: "quote",
    title: "Quote",
    description: "Insert a quote block",
    icon: "Quote",
    category: "text",
    keywords: ["quote", "citation"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "quote");
    },
  },
  {
    id: "callout",
    title: "Callout",
    description: "Insert a callout block",
    icon: "Sparkles",
    category: "text",
    keywords: ["callout", "note", "info"],
    run: (context) => {
      context.onChangeBlockType?.(context.blockId, "callout");
    },
  },
];

// Research-specific commands
export const RESEARCH_COMMANDS: SlashCommandItem[] = [
  {
    id: "summary",
    title: "Summary",
    description: "Generate summary for selected text or paper",
    icon: "Sparkles",
    category: "research",
    keywords: ["summarize", "abstract"],
    run: async (context) => {
      await context.onExecuteApi?.("summary", {
        paperId: context.paperId,
      });
    },
  },
  {
    id: "figure",
    title: "Insert Figure",
    description: "Fetch and insert nearby figures from the paper",
    icon: "Image",
    category: "research",
    keywords: ["fig", "image", "diagram"],
    run: async (context) => {
      await context.onExecuteApi?.("figure", {
        paperId: context.paperId,
      });
    },
  },
  {
    id: "cite",
    title: "Citations",
    description: "Insert citations referenced in this section",
    icon: "Quote",
    category: "research",
    keywords: ["citation", "reference", "cite"],
    run: async (context) => {
      await context.onExecuteApi?.("citation", {
        paperId: context.paperId,
      });
    },
  },
  {
    id: "arxiv",
    title: "Insert from arXiv",
    description: "Pull sections and figures from an arXiv paper",
    icon: "Globe",
    category: "research",
    keywords: ["arxiv", "paper", "import"],
    run: async (context) => {
      await context.onExecuteApi?.("arxiv", {
        paperId: context.paperId,
      });
    },
  },
  {
    id: "explain",
    title: "Explain",
    description: "Get explanation of selected text",
    icon: "Sparkles",
    category: "research",
    keywords: ["explain", "clarify", "what"],
    run: async (context) => {
      await context.onExecuteApi?.("explain", {
        paperId: context.paperId,
        text: context.currentContent,
      });
    },
  },
  {
    id: "compare",
    title: "Compare",
    description: "Compare with related work or concepts",
    icon: "Layers",
    category: "research",
    keywords: ["compare", "vs", "versus"],
    run: async (context) => {
      await context.onExecuteApi?.("compare", {
        paperId: context.paperId,
        text: context.currentContent,
      });
    },
  },
  {
    id: "chat",
    title: "AI Chat",
    description: "Insert inline chat assistant",
    icon: "MessageSquare",
    category: "research",
    keywords: ["chat", "ai", "assistant", "help"],
    run: (context) => {
      // Insert a chat_message block at the current position
      context.onInsertBlock?.("chat_message", context.blockIndex + 1, "");
    },
  },
];

// Content insertion commands
export const CONTENT_COMMANDS: SlashCommandItem[] = [
  {
    id: "divider",
    title: "Divider",
    description: "Insert a horizontal divider",
    icon: "CircleDashed",
    category: "content",
    keywords: ["hr", "line", "separator"],
    run: (context) => {
      context.onInsertBlock?.("divider", context.blockIndex);
    },
  },
];

export function getAllSlashCommands(): SlashCommandItem[] {
  return [...TEXT_COMMANDS, ...RESEARCH_COMMANDS, ...CONTENT_COMMANDS];
}

export function buildSlashCommandItems(
  context: SlashCommandContext,
): SlashCommandItem[] {
  return getAllSlashCommands().map((cmd) => ({
    ...cmd,
    run: () => cmd.run(context),
  }));
}

