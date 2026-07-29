import type { Block } from "./types";
import type { BlockNavigateDetail } from "./navigation";

/**
 * Pure resolution of "which block does this citation point at?".
 * Kept free of React and the DOM so the matching ladder is testable
 * (the vitest env is node, not jsdom).
 */

const COMPARISON_LENGTH = 200;
const MIN_FUZZY_QUOTE_LENGTH = 20;
const MIN_FUZZY_WORD_LENGTH = 3;
const MAX_FUZZY_MATCHES = 3;
const PAGE_TOLERANCE = 1;

const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Strip tags without a DOM: block content is trusted, generated markup. */
function toPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity);
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, COMPARISON_LENGTH);
}

function matchByQuote(blocks: Block[], quote: string): Block | undefined {
  const normalizedQuote = normalizeText(quote);
  if (!normalizedQuote) {
    return undefined;
  }

  const exact = blocks.find((block) => {
    const blockText = normalizeText(toPlainText(block.content));
    if (!blockText) return false;
    return blockText.includes(normalizedQuote) || normalizedQuote.includes(blockText);
  });
  if (exact) {
    return exact;
  }

  if (normalizedQuote.length <= MIN_FUZZY_QUOTE_LENGTH) {
    return undefined;
  }

  const quoteWords = normalizedQuote
    .split(" ")
    .filter((word) => word.length > MIN_FUZZY_WORD_LENGTH);
  if (quoteWords.length === 0) {
    return undefined;
  }

  const minMatches = Math.min(MAX_FUZZY_MATCHES, quoteWords.length);
  return blocks.find((block) => {
    const blockText = normalizeText(toPlainText(block.content));
    const matching = quoteWords.filter((word) => blockText.includes(word));
    return matching.length >= minMatches;
  });
}

function matchByPage(blocks: Block[], page: number): Block | undefined {
  return (
    blocks.find((block) => block.metadata?.page === page) ??
    blocks.find((block) => {
      const blockPage = block.metadata?.page;
      return Boolean(blockPage) && Math.abs(blockPage! - page) <= PAGE_TOLERANCE;
    }) ??
    blocks.find((block) => {
      const blockPage = block.metadata?.page;
      return Boolean(blockPage) && blockPage! >= page;
    })
  );
}

/** Chunk ids often lead with a section marker, e.g. `S1-p1` or `3-p2`. */
function matchBySection(blocks: Block[], chunkId: string): Block | undefined {
  const sectionMatch = chunkId.match(/^[A-Z]?\d+/);
  if (!sectionMatch) {
    return undefined;
  }

  const sectionId = sectionMatch[0];
  return blocks.find(
    (block) =>
      block.metadata?.section?.includes(sectionId) ||
      block.content.toLowerCase().includes(sectionId.toLowerCase()),
  );
}

/**
 * Match strongest signal first: chunk id, then quote text, then page, then a
 * section prefix guess. Dividers are structural and are never a target.
 */
export function resolveNavigationTarget(
  blocks: Block[],
  detail: Pick<BlockNavigateDetail, "chunkId" | "page" | "quote">,
): Block | undefined {
  const contentBlocks = blocks.filter((block) => block.type !== "divider");

  if (detail.chunkId) {
    const byChunk = contentBlocks.find((block) => block.metadata?.chunkId === detail.chunkId);
    if (byChunk) return byChunk;
  }

  if (detail.quote) {
    const byQuote = matchByQuote(contentBlocks, detail.quote);
    if (byQuote) return byQuote;
  }

  if (detail.page) {
    const byPage = matchByPage(contentBlocks, detail.page);
    if (byPage) return byPage;
  }

  if (detail.chunkId) {
    return matchBySection(contentBlocks, detail.chunkId);
  }

  return undefined;
}
