/**
 * Command handlers for slash commands
 * These connect slash commands to backend APIs and block operations
 */

import type { BlockType } from "./types";

export interface CommandHandlerContext {
  paperId: string;
  blockId: string;
  blockIndex: number;
  onChangeBlockType: (blockId: string, newType: BlockType) => void;
  onInsertBlock: (type: BlockType, index: number, content?: string) => void;
  onOpenChat?: () => void;
}

export async function handleSlashCommand(
  command: string,
  context: CommandHandlerContext,
): Promise<void> {
  const { paperId, blockId, blockIndex, onChangeBlockType, onInsertBlock, onOpenChat } = context;

  switch (command) {
    // Text formatting commands
    case "heading1":
    case "h1":
      onChangeBlockType(blockId, "heading_1");
      break;
    case "heading2":
    case "h2":
      onChangeBlockType(blockId, "heading_2");
      break;
    case "heading3":
    case "h3":
      onChangeBlockType(blockId, "heading_3");
      break;
    case "bullet":
    case "ul":
      onChangeBlockType(blockId, "bullet_list");
      break;
    case "number":
    case "ol":
      onChangeBlockType(blockId, "number_list");
      break;
    case "todo":
    case "checkbox":
      onChangeBlockType(blockId, "to_do_list");
      break;
    case "code":
      onChangeBlockType(blockId, "code");
      break;
    case "divider":
      onInsertBlock("divider", blockIndex);
      break;

    // Research commands - these will call backend APIs
    case "summary":
      await executeSummaryCommand(paperId, blockId, blockIndex, onInsertBlock);
      break;
    case "figure":
    case "fig":
      await executeFigureCommand(paperId, blockId, blockIndex, onInsertBlock);
      break;
    case "cite":
    case "citation":
      await executeCitationCommand(paperId, blockId, blockIndex, onInsertBlock);
      break;
    case "arxiv":
      await executeArxivCommand(paperId, blockId, blockIndex, onInsertBlock);
      break;
    case "chat":
      onOpenChat?.();
      break;
    case "explain":
    case "compare":
    case "eli5":
      // These will be handled via chat or inline API calls
      // For now, open chat with the command
      onOpenChat?.();
      break;

    default:
      console.warn(`Unknown slash command: ${command}`);
  }
}

async function executeSummaryCommand(
  paperId: string,
  blockId: string,
  blockIndex: number,
  onInsertBlock: (type: BlockType, index: number, content?: string) => void,
): Promise<void> {
  try {
    const response = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paperId }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate summary");
    }

    const result = await response.json();
    // TODO: Parse summary result into blocks
    // For now, just insert as text
    onInsertBlock("paragraph", blockIndex, JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("Failed to execute summary command:", error);
  }
}

// TODO: Implement these commands in Phase 6
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeFigureCommand(
  _paperId: string,
  _blockId: string,
  _blockIndex: number,
  _onInsertBlock: (type: BlockType, index: number, content?: string) => void,
): Promise<void> {
  // TODO: Implement figure fetching
  // This should call /api/editor/selection/figures
  console.log("Figure command not yet implemented");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeCitationCommand(
  _paperId: string,
  _blockId: string,
  _blockIndex: number,
  _onInsertBlock: (type: BlockType, index: number, content?: string) => void,
): Promise<void> {
  // TODO: Implement citation fetching
  // This should call /api/editor/selection/citations
  console.log("Citation command not yet implemented");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function executeArxivCommand(
  _paperId: string,
  _blockId: string,
  _blockIndex: number,
  _onInsertBlock: (type: BlockType, index: number, content?: string) => void,
): Promise<void> {
  // TODO: Implement arXiv ingestion
  // This should call /api/editor/ingest/arxiv
  console.log("ArXiv command not yet implemented");
}

