/**
 * Block type definitions for Notion-style editor
 */

export type BlockType =
  // Text blocks
  | "paragraph"
  | "heading_1"
  | "heading_2"
  | "heading_3"
  // List blocks
  | "bullet_list"
  | "number_list"
  | "to_do_list"
  // Special blocks
  | "code"
  | "quote"
  | "callout"
  // Research-specific blocks
  | "summary_section"
  | "figure"
  | "citation"
  | "chat_message"
  | "divider";

export interface BlockMetadata {
  page?: number;
  section?: string;
  figureId?: string;
  caption?: string;
  imageUrl?: string;
  citationId?: string;
  author?: string;
  title?: string;
  url?: string;
  checked?: boolean; // for to_do_list
  [key: string]: unknown;
}

export interface Block {
  id: string;
  type: BlockType;
  content: string; // Plain text or HTML content
  metadata?: BlockMetadata;
  children?: Block[]; // For nested blocks (e.g., list items)
}

export interface EditorState {
  blocks: Block[];
  paperId: string;
  loading: boolean;
  error: string | null;
}

export interface BlockOperation {
  type: "create" | "update" | "delete" | "move";
  blockId: string;
  block?: Block;
  newIndex?: number;
  oldIndex?: number;
}

