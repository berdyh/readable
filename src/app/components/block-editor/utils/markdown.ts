/**
 * Utility functions for converting between HTML (TipTap format) and Markdown
 * This allows us to store content as Markdown while using TipTap for editing
 */

import TurndownService from "turndown";
import { marked } from "marked";

// Configure Turndown for converting HTML to Markdown
const turndownService = new TurndownService({
  headingStyle: "atx", // Use # for headings
  codeBlockStyle: "fenced", // Use ``` for code blocks
  bulletListMarker: "-", // Use - for bullet lists
  emDelimiter: "*", // Use * for emphasis
});

// Custom rules for better Markdown conversion
turndownService.addRule("strikethrough", {
  filter: (node) => {
    return (
      node.nodeName === "DEL" ||
      node.nodeName === "S" ||
      (node.nodeName === "SPAN" &&
        (node as HTMLElement).style.textDecoration?.includes("line-through"))
    );
  },
  replacement: (content) => `~~${content}~~`,
});

// Preserve checkbox syntax for todo lists
turndownService.addRule("checkbox", {
  filter: (node) => {
    return node.nodeName === "INPUT" && (node as HTMLInputElement).type === "checkbox";
  },
  replacement: (_content, node) => {
    const input = node as HTMLInputElement;
    return input.checked ? "[x]" : "[ ]";
  },
});

// Configure marked for converting Markdown to HTML
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: false, // Don't convert line breaks to <br>
});

function stripTodoPrefix(markdown: string): { checked: boolean; content: string } | null {
  const match = markdown.trim().match(/^\[([ xX])\]\s*(.*)$/);
  if (!match) return null;
  return {
    checked: match[1].toLowerCase() === "x",
    content: match[2],
  };
}

function stripBulletPrefix(markdown: string): string | null {
  const match = markdown.trim().match(/^[*+-]\s+(.*)$/);
  return match ? match[1] : null;
}

function stripNumberPrefix(markdown: string): { marker: string; content: string } | null {
  const match = markdown.trim().match(/^(\d+)[.)]\s+(.*)$/);
  if (!match) return null;
  return {
    marker: `${match[1]}.`,
    content: match[2],
  };
}

function normalizeSingleItemListMarkdown(markdown: string, blockType?: string): string {
  const trimmed = markdown.trim();

  if (blockType === "bullet_list") {
    const bullet = stripBulletPrefix(trimmed);
    if (bullet !== null) return bullet ? `- ${bullet.trim()}` : "";

    const number = stripNumberPrefix(trimmed);
    if (number) return number.content.trim() ? `- ${number.content.trim()}` : "";

    const todo = stripTodoPrefix(trimmed);
    if (todo) return todo.content.trim() ? `- ${todo.content.trim()}` : "";

    return trimmed ? `- ${trimmed}` : "";
  }

  if (blockType === "number_list") {
    const number = stripNumberPrefix(trimmed);
    if (number) {
      const content = number.content.trim();
      return content ? `${number.marker} ${content}` : "";
    }

    const bullet = stripBulletPrefix(trimmed);
    if (bullet !== null) return bullet.trim() ? `1. ${bullet.trim()}` : "";

    const todo = stripTodoPrefix(trimmed);
    if (todo) return todo.content.trim() ? `1. ${todo.content.trim()}` : "";

    return trimmed ? `1. ${trimmed}` : "";
  }

  if (blockType === "to_do_list") {
    const todo = stripTodoPrefix(trimmed);
    if (todo) {
      const content = todo.content.trim();
      return content ? `[${todo.checked ? "x" : " "}] ${content}` : `[${todo.checked ? "x" : " "}]`;
    }

    return trimmed ? `[ ] ${trimmed}` : "";
  }

  return trimmed;
}

/**
 * Convert HTML content to Markdown format
 * @param html - HTML content from TipTap
 * @param blockType - Type of block (for context-specific conversion)
 * @returns Markdown string
 */
export function htmlToMarkdown(html: string, blockType?: string): string {
  if (!html || html.trim() === "") {
    return "";
  }

  // Handle code blocks specially
  if (blockType === "code") {
    const langMatch = html.match(
      /<pre[^>]*><code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code><\/pre>/,
    );
    if (langMatch) {
      const language = langMatch[1];
      const code = decodeHtmlEntities(langMatch[2]).replace(/\n+$/, "");
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }

    const codeMatch = html.match(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/);
    if (codeMatch) {
      const code = decodeHtmlEntities(codeMatch[1]).replace(/\n+$/, "");
      return `\`\`\`\n${code}\n\`\`\``;
    }

    if (html.includes("<code")) {
      return html.replace(/<code[^>]*>([^<]*)<\/code>/g, "`$1`");
    }
  }

  if (blockType === "to_do_list") {
    const checkedMatch = html.match(/data-type="taskItem"[^>]*data-checked="(true|false)"/i);
    const contentMatch = html.match(/<div><p>([\s\S]*?)<\/p><\/div>/i);

    if (checkedMatch) {
      const checked = checkedMatch[1] === "true";
      const contentMarkdown = contentMatch
        ? turndownService.turndown(contentMatch[1]).trim()
        : turndownService.turndown(html.replace(/<label>[\s\S]*?<\/label>/i, "")).trim();
      return `[${checked ? "x" : " "}] ${contentMarkdown}`.trim();
    }

    return turndownService
      .turndown(html)
      .trim()
      .replace(/^\\([*+-]\s)/gm, "$1");
  }

  // Handle headings
  if (blockType?.startsWith("heading_")) {
    const level = blockType === "heading_1" ? 1 : blockType === "heading_2" ? 2 : 3;
    const headingMatch = html.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/);
    if (headingMatch) {
      const content = turndownService.turndown(headingMatch[1]).trim();
      return `${"#".repeat(level)} ${content}`;
    }
    const content = html.replace(/<[^>]+>/g, "").trim();
    if (content) {
      return `${"#".repeat(level)} ${content}`;
    }
  }

  // Handle quotes
  if (blockType === "quote") {
    const content = turndownService.turndown(html);
    return content
      .split("\n")
      .map((line) => {
        const normalized = line.trim().replace(/^>\s*/, "").trim();
        return normalized ? `> ${normalized}` : "";
      })
      .filter(Boolean)
      .join("\n");
  }

  const markdown = turndownService.turndown(html).trim();
  return normalizeSingleItemListMarkdown(markdown, blockType);
}

/**
 * Convert Markdown content to HTML format for TipTap
 * @param markdown - Markdown content
 * @param blockType - Type of block (for context-specific conversion)
 * @returns HTML string
 */
export function markdownToHtml(markdown: string, blockType?: string): string {
  if (!markdown || markdown.trim() === "") {
    return "";
  }

  // Handle code blocks specially
  if (blockType === "code") {
    const codeBlockMatch = markdown.match(/^```(\w+)?\n([\s\S]*?)```$/);
    if (codeBlockMatch) {
      const language = codeBlockMatch[1] || "";
      const code = codeBlockMatch[2];
      return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
    }

    if (markdown.includes("`") && !markdown.includes("```")) {
      const parsed = marked.parse(markdown) as string;
      return parsed;
    }
  }

  // Handle headings
  if (blockType?.startsWith("heading_")) {
    const headingMatch = markdown.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      return `<h${level}>${content}</h${level}>`;
    }
    if (markdown.startsWith("#")) {
      const parsed = marked.parse(markdown) as string;
      return parsed;
    }
  }

  // Handle quotes
  if (blockType === "quote") {
    const content = markdown.replace(/^>\s*/gm, "");
    const parsed = marked.parse(content) as string;
    if (!parsed.includes("<blockquote")) {
      return `<blockquote>${parsed}</blockquote>`;
    }
    return parsed;
  }

  if (blockType === "to_do_list") {
    const normalized = normalizeSingleItemListMarkdown(markdown, blockType);
    if (!normalized) {
      return "";
    }
    const content = normalized.replace(/^\[[ xX]\]\s*/, "").trim();
    return marked.parseInline(content) as string;
  }

  if (blockType === "bullet_list") {
    const normalized = normalizeSingleItemListMarkdown(markdown, blockType);
    return normalized ? (marked.parse(normalized) as string) : "";
  }

  if (blockType === "number_list") {
    const normalized = normalizeSingleItemListMarkdown(markdown, blockType);
    return normalized ? (marked.parse(normalized) as string) : "";
  }

  return marked.parse(markdown) as string;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

/**
 * Decode HTML entities
 * Uses browser API - only call from client components
 */
function decodeHtmlEntities(text: string): string {
  if (typeof document === "undefined") {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ");
  }
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}
