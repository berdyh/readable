/**
 * Utility functions for converting between HTML (TipTap format) and Markdown
 * This allows us to store content as Markdown while using TipTap for editing
 *
 * The one rule that keeps the conversion honest: **content never carries the
 * block-level marker its type already encodes**. A `heading_2` stores
 * `Introduction`, not `## Introduction`; a `bullet_list` stores the item text,
 * not `- item`. Storing it twice means the two copies can disagree, and the
 * round trip "corrects" the difference — rewriting a block the reader never
 * touched the moment TipTap is handed the block. Markers that carry something
 * the type does not — a to-do's checked state, a code block's language — stay
 * in the content, because there is nowhere else for them to live.
 */

import TurndownService from "turndown";
import { marked } from "marked";

function createTurndownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx", // Use # for headings
    codeBlockStyle: "fenced", // Use ``` for code blocks
    bulletListMarker: "-", // Use - for bullet lists
    emDelimiter: "*", // Use * for emphasis
  });

  // Custom rules for better Markdown conversion
  service.addRule("strikethrough", {
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
  service.addRule("checkbox", {
    filter: (node) => {
      return node.nodeName === "INPUT" && (node as HTMLInputElement).type === "checkbox";
    },
    replacement: (_content, node) => {
      const input = node as HTMLInputElement;
      return input.checked ? "[x]" : "[ ]";
    },
  });

  return service;
}

const turndownService = createTurndownService();

/**
 * Same conversion, minus Turndown's escaping.
 *
 * Turndown escapes anything that could be read back as block syntax, so a
 * heading titled `1. Introduction` comes back as `1\. Introduction` and
 * `x_i` as `x\_i`. For prose that escape is load-bearing; for a heading it is
 * not, because headings are rendered with `marked.parseInline`, which never
 * applies block rules. Without this the heading round trip would rewrite the
 * very titles it is supposed to leave alone.
 */
const inlineTurndownService = createTurndownService();
inlineTurndownService.escape = (text: string) => text;

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

function stripHeadingPrefix(markdown: string): string | null {
  const match = markdown.trim().match(/^#{1,6}\s+(.*)$/);
  return match ? match[1] : null;
}

function stripQuotePrefix(markdown: string): string {
  return markdown
    .split("\n")
    .map((line) => line.trim().replace(/^>\s*/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * The item text of a single-item list block, with whichever marker it happens
 * to arrive with removed.
 *
 * Any flavour is accepted, not just the block's own: a bullet pasted into a
 * numbered list, or content converted between list types, must not end up
 * carrying a marker of the type it left behind.
 */
function listItemText(markdown: string): string {
  const trimmed = markdown.trim();

  const bullet = stripBulletPrefix(trimmed);
  if (bullet !== null) return bullet.trim();

  const number = stripNumberPrefix(trimmed);
  if (number) return number.content.trim();

  const todo = stripTodoPrefix(trimmed);
  if (todo) return todo.content.trim();

  return trimmed;
}

/**
 * Strip whatever block-level marker `blockType` implies, so that stored content
 * is the same string whether it arrived from a parser (bare, as they all write
 * it) or from a document written before this rule existed (marked up).
 */
function stripBlockMarker(markdown: string, blockType?: string): string {
  if (blockType?.startsWith("heading_")) {
    return (stripHeadingPrefix(markdown) ?? markdown).trim();
  }

  if (blockType === "quote") {
    return stripQuotePrefix(markdown);
  }

  if (blockType === "bullet_list" || blockType === "number_list") {
    return listItemText(markdown);
  }

  return markdown.trim();
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

  // Handle headings. The level lives in `blockType`, so no `#` is written:
  // re-deriving one here is what used to rewrite `Paper Summary` into
  // `# Paper Summary` the moment a locked heading was unlocked.
  if (blockType?.startsWith("heading_")) {
    const headingMatch = html.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/);
    const source = headingMatch ? headingMatch[1] : html;
    return stripBlockMarker(inlineTurndownService.turndown(source), blockType);
  }

  // Handle quotes
  if (blockType === "quote") {
    return stripBlockMarker(turndownService.turndown(html), blockType);
  }

  const markdown = turndownService.turndown(html).trim();
  return stripBlockMarker(markdown, blockType);
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

  // Handle headings. A heading holds one line of title text, so it is parsed
  // inline: block rules would read a title like `1. Introduction` as an ordered
  // list and lose the number. TipTap has `heading: false` — the level is styled
  // from the block type — so a paragraph is the right host element.
  if (blockType?.startsWith("heading_")) {
    const title = stripBlockMarker(markdown, blockType);
    return title ? `<p>${marked.parseInline(title) as string}</p>` : "";
  }

  // Handle quotes
  if (blockType === "quote") {
    const content = stripBlockMarker(markdown, blockType);
    const parsed = marked.parse(content) as string;
    if (!parsed.includes("<blockquote")) {
      return `<blockquote>${parsed}</blockquote>`;
    }
    return parsed;
  }

  if (blockType === "to_do_list") {
    const content = listItemText(markdown);
    return content ? (marked.parseInline(content) as string) : "";
  }

  if (blockType === "bullet_list") {
    const item = listItemText(markdown);
    return item ? (marked.parse(`- ${item}`) as string) : "";
  }

  if (blockType === "number_list") {
    const item = listItemText(markdown);
    return item ? (marked.parse(`1. ${item}`) as string) : "";
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
