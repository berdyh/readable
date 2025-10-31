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
  bulletListMarker: "*", // Use * for bullet lists
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
    return (
      node.nodeName === "INPUT" &&
      (node as HTMLInputElement).type === "checkbox"
    );
  },
  replacement: (content, node) => {
    const input = node as HTMLInputElement;
    return input.checked ? "[x]" : "[ ]";
  },
});

// Configure marked for converting Markdown to HTML
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: false, // Don't convert line breaks to <br>
});

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
    // Extract language from code block if present
    // TipTap code blocks might have class="language-{lang}"
    const langMatch = html.match(/<pre[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/);
    if (langMatch) {
      const language = langMatch[1];
      const code = decodeHtmlEntities(langMatch[2]);
      return `\`\`\`${language}\n${code}\n\`\`\``;
    }
    
    // Plain code block
    const codeMatch = html.match(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/);
    if (codeMatch) {
      const code = decodeHtmlEntities(codeMatch[1]);
      return `\`\`\`\n${code}\n\`\`\``;
    }
    
    // Inline code - convert <code> tags to backticks
    if (html.includes("<code")) {
      return html.replace(/<code[^>]*>([^<]*)<\/code>/g, "`$1`");
    }
  }

  // Handle todo blocks - preserve [ ] or [x] syntax
  if (blockType === "to_do_list") {
    // Check if there's a checkbox in the HTML (from markdown conversion or direct HTML)
    const checkboxMatch = html.match(/<input[^>]*type=["']checkbox["'][^>]*(checked[^>]*>|>)/);
    if (checkboxMatch) {
      const isChecked = checkboxMatch[0].includes("checked");
      // Remove checkbox HTML and any hidden checkbox markers
      const content = html.replace(/<input[^>]*type=["']checkbox["'][^>]*>/g, "").replace(/data-markdown-checkbox[^>]*/g, "").trim();
      const markdown = turndownService.turndown(content);
      // Remove leading/trailing whitespace
      const cleanMarkdown = markdown.trim();
      return `${isChecked ? "[x]" : "[ ]"} ${cleanMarkdown}`;
    }
    // If content already starts with [ ] or [x], preserve it
    if (html.match(/^\[[ xX]\]/)) {
      return turndownService.turndown(html);
    }
  }

  // Handle headings
  if (blockType?.startsWith("heading_")) {
    const level = blockType === "heading_1" ? 1 : blockType === "heading_2" ? 2 : 3;
    // Extract text content, preserving formatting
    const headingMatch = html.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/);
    if (headingMatch) {
      const content = turndownService.turndown(headingMatch[1]).trim();
      return `${"#".repeat(level)} ${content}`;
    }
    // Fallback: strip HTML tags
    const content = html.replace(/<[^>]+>/g, "").trim();
    if (content) {
      return `${"#".repeat(level)} ${content}`;
    }
  }

  // Handle bullet lists
  // For bullet_list blocks, we store just the content without the bullet marker
  // The bullet is displayed by the ListBlock component, not in the markdown
  // TipTap renders content as paragraphs (since list extensions are disabled)
  if (blockType === "bullet_list") {
    // Extract text content from paragraphs (TipTap renders as <p>content</p>)
    // Remove list structure if present (from old format)
    const liMatch = html.match(/<li[^>]*>([\s\S]*?)<\/li>/);
    if (liMatch) {
      const content = turndownService.turndown(liMatch[1]).trim();
      return content.replace(/^[\*\-\+]\s+/, "").trim();
    }
    // For paragraph content (current format)
    const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (pMatch) {
      const content = turndownService.turndown(pMatch[1]).trim();
      return content.replace(/^[\*\-\+]\s+/, "").trim();
    }
    // Fallback: use turndown but strip list markers
    const markdown = turndownService.turndown(html);
    return markdown.replace(/^[\*\-\+]\s+/gm, "").trim();
  }

  // Handle numbered lists
  // For number_list blocks, we store just the content without the number marker
  // The number is displayed by the ListBlock component based on index
  // TipTap renders content as paragraphs (since list extensions are disabled)
  if (blockType === "number_list") {
    // Extract text content from paragraphs or list items
    const liMatch = html.match(/<li[^>]*>([\s\S]*?)<\/li>/);
    if (liMatch) {
      const content = turndownService.turndown(liMatch[1]).trim();
      return content.replace(/^\d+\.\s+/, "").trim();
    }
    // For paragraph content (current format)
    const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    if (pMatch) {
      const content = turndownService.turndown(pMatch[1]).trim();
      return content.replace(/^\d+\.\s+/, "").trim();
    }
    // Fallback
    return turndownService.turndown(html).replace(/^\d+\.\s+/gm, "").trim();
  }

  // Handle quotes
  if (blockType === "quote") {
    const content = turndownService.turndown(html);
    // Ensure each line has > prefix
    return content.split("\n").map((line) => line.trim() ? `> ${line.trim()}` : "").filter(Boolean).join("\n");
  }

  // Default conversion
  return turndownService.turndown(html).trim();
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
    // Parse ```language or ``` code blocks
    const codeBlockMatch = markdown.match(/^```(\w+)?\n([\s\S]*?)```$/);
    if (codeBlockMatch) {
      const language = codeBlockMatch[1] || "";
      const code = codeBlockMatch[2];
      return `<pre><code class="language-${language}">${escapeHtml(code)}</code></pre>`;
    }
    
    // Inline code
    if (markdown.includes("`") && !markdown.includes("```")) {
      const parsed = marked.parse(markdown) as string;
      return parsed;
    }
  }

  // Handle todo blocks - parse [ ] or [x] syntax
  if (blockType === "to_do_list") {
    const todoMatch = markdown.match(/^(\[[ xX]\])?\s*(.+)$/);
    if (todoMatch) {
      const checkbox = todoMatch[1] || "[ ]";
      const isChecked = checkbox.toLowerCase().includes("x");
      const content = todoMatch[2];
      const html = marked.parse(content) as string;
      // Remove wrapping <p> tags if present
      const cleanHtml = html.replace(/^<p>|<\/p>$/g, "");
      return `<input type="checkbox" ${isChecked ? "checked" : ""} disabled style="display: none;" data-markdown-checkbox />${cleanHtml}`;
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
    // If markdown already has #, just parse it
    if (markdown.startsWith("#")) {
      const parsed = marked.parse(markdown) as string;
      return parsed;
    }
  }

  // Handle quotes
  if (blockType === "quote") {
    // Remove > prefix if present and parse
    const content = markdown.replace(/^>\s*/gm, "");
    const parsed = marked.parse(content) as string;
    // Wrap in blockquote if not already
    if (!parsed.includes("<blockquote")) {
      return `<blockquote>${parsed}</blockquote>`;
    }
    return parsed;
  }

  // Handle bullet lists
  // For bullet_list blocks, the markdown content is just the text (no * prefix)
  // Since TipTap list extensions are disabled, we render as paragraph
  if (blockType === "bullet_list") {
    // Remove leading * or - if present (shouldn't be for individual items)
    const cleanMarkdown = markdown.replace(/^[\*\-\+]\s+/, "").trim();
    if (!cleanMarkdown) return "";
    // Parse as paragraph content (TipTap will handle as paragraph)
    const parsed = marked.parseInline(cleanMarkdown) as string;
    // Return as paragraph content (TipTap's paragraph extension will handle it)
    return parsed || cleanMarkdown;
  }

  // Handle numbered lists in markdownToHtml
  // For number_list blocks, the markdown content is just the text (no number prefix)
  // Since TipTap list extensions are disabled, we render as paragraph
  if (blockType === "number_list") {
    // Remove leading number pattern if present
    const cleanMarkdown = markdown.replace(/^\d+\.\s+/, "").trim();
    if (!cleanMarkdown) return "";
    // Parse as paragraph content
    const parsed = marked.parseInline(cleanMarkdown) as string;
    return parsed || cleanMarkdown;
  }

  // Default conversion
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
    // Server-side: basic entity decoding
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

