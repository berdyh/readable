/**
 * API handlers for slash commands
 * These connect slash commands to backend APIs and insert blocks using parsers
 */

import type { Block } from "./types";
import {
  parseSummaryToBlocks,
  parseFiguresToBlocks,
  parseCitationsToBlocks,
  parseSelectionSummaryToBlocks,
} from "./parsers";
import type { SelectionFiguresResult, SelectionCitationsResult, SelectionSummaryResult } from "@/server/editor/types";
import type { SummaryResult } from "@/server/summarize/types";
import type { QuestionSelection } from "@/server/qa/types";

export interface ApiHandlerContext {
  paperId: string;
  blockIndex: number;
  onInsertBlocks: (blocks: Block[]) => void;
  selection?: QuestionSelection;
  userId?: string;
  personaId?: string;
}

/**
 * Execute API command and insert resulting blocks
 */
export async function executeApiCommand(
  command: string,
  context: ApiHandlerContext,
): Promise<void> {
  const { paperId, blockIndex, onInsertBlocks, selection, userId, personaId } = context;

  try {
    switch (command) {
      case "summary":
        await executeSummary(paperId, blockIndex, onInsertBlocks, userId, personaId);
        break;
      case "figure":
        await executeFigures(paperId, blockIndex, onInsertBlocks, selection);
        break;
      case "citation":
        await executeCitations(paperId, blockIndex, onInsertBlocks, selection);
        break;
      case "explain":
        await executeSelectionSummary(paperId, blockIndex, onInsertBlocks, selection, userId, personaId);
        break;
      case "compare":
      case "eli5":
      case "arxiv":
        // TODO: Implement these in future phases
        console.warn(`Command ${command} not yet implemented`);
        break;
      default:
        console.warn(`Unknown API command: ${command}`);
    }
  } catch (error) {
    console.error(`Failed to execute API command ${command}:`, error);
    throw error;
  }
}

/**
 * Execute /api/summarize and parse result into blocks
 */
async function executeSummary(
  paperId: string,
  blockIndex: number,
  onInsertBlocks: (blocks: Block[]) => void,
  userId?: string,
  personaId?: string,
): Promise<void> {
  const response = await fetch("/api/summarize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, userId, personaId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to generate summary" }));
    throw new Error(error.error || `Failed to generate summary: ${response.status}`);
  }

  const result = (await response.json()) as SummaryResult;
  const blocks = parseSummaryToBlocks(result);
  
  if (blocks.length > 0) {
    onInsertBlocks(blocks);
  }
}

/**
 * Execute /api/editor/selection/figures and parse result into blocks
 */
async function executeFigures(
  paperId: string,
  blockIndex: number,
  onInsertBlocks: (blocks: Block[]) => void,
  selection?: QuestionSelection,
): Promise<void> {
  if (!selection?.text) {
    throw new Error("Text selection is required to fetch figures");
  }

  const response = await fetch("/api/editor/selection/figures", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, selection }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to fetch figures" }));
    throw new Error(error.error || `Failed to fetch figures: ${response.status}`);
  }

  const result = (await response.json()) as SelectionFiguresResult;
  const blocks = parseFiguresToBlocks(result);
  
  if (blocks.length > 0) {
    onInsertBlocks(blocks);
  } else {
    // Insert a placeholder if no figures found
    onInsertBlocks([{
      id: `placeholder-${Date.now()}`,
      type: "paragraph",
      content: "No figures found for this selection.",
    }]);
  }
}

/**
 * Execute /api/editor/selection/citations and parse result into blocks
 */
async function executeCitations(
  paperId: string,
  blockIndex: number,
  onInsertBlocks: (blocks: Block[]) => void,
  selection?: QuestionSelection,
): Promise<void> {
  if (!selection?.text) {
    throw new Error("Text selection is required to fetch citations");
  }

  const response = await fetch("/api/editor/selection/citations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, selection }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to fetch citations" }));
    throw new Error(error.error || `Failed to fetch citations: ${response.status}`);
  }

  const result = (await response.json()) as SelectionCitationsResult;
  const blocks = parseCitationsToBlocks(result);
  
  if (blocks.length > 0) {
    onInsertBlocks(blocks);
  } else {
    // Insert a placeholder if no citations found
    onInsertBlocks([{
      id: `placeholder-${Date.now()}`,
      type: "paragraph",
      content: "No citations found for this selection.",
    }]);
  }
}

/**
 * Execute /api/editor/selection/summary and parse result into blocks
 */
async function executeSelectionSummary(
  paperId: string,
  blockIndex: number,
  onInsertBlocks: (blocks: Block[]) => void,
  selection?: QuestionSelection,
  userId?: string,
  personaId?: string,
): Promise<void> {
  if (!selection?.text) {
    throw new Error("Text selection is required to generate summary");
  }

  const response = await fetch("/api/editor/selection/summary", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paperId, selection, userId, personaId }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: "Failed to generate selection summary" }));
    throw new Error(error.error || `Failed to generate selection summary: ${response.status}`);
  }

  const result = (await response.json()) as SelectionSummaryResult;
  const blocks = parseSelectionSummaryToBlocks(result);
  
  if (blocks.length > 0) {
    onInsertBlocks(blocks);
  }
}

