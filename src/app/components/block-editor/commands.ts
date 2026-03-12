import type { BlockType } from "./types";
import {
  getSlashCommandById,
  SLASH_COMMAND_REGISTRY,
  type ApiCommandId,
  type SlashCommandCategory,
  type SlashCommandId,
} from "./commandRegistry";

export interface SlashCommandItem {
  id: SlashCommandId;
  title: string;
  description: string;
  icon: string;
  category?: SlashCommandCategory;
  keywords?: string[];
  run: (context: SlashCommandContext) => void | Promise<void>;
}

export interface SlashCommandContext {
  blockId: string;
  blockIndex: number;
  blockType: BlockType;
  currentContent: string;
  paperId?: string;
  onChangeBlockType?: (blockId: string, newType: BlockType) => void;
  onInsertBlock?: (type: BlockType, index: number, content?: string) => void;
  onExecuteApi?: (command: ApiCommandId, params?: Record<string, unknown>) => Promise<void>;
}

function runSlashCommand(
  commandId: SlashCommandId,
  context: SlashCommandContext,
): void | Promise<void> {
  const commandMeta = getSlashCommandById(commandId);
  const backendCommand = commandMeta?.backendCommand;

  if (backendCommand) {
    const params: Record<string, unknown> = { paperId: context.paperId };
    if (commandId === "explain" || commandId === "compare") {
      params.text = context.currentContent;
    }
    return context.onExecuteApi?.(backendCommand, params);
  }

  switch (commandId) {
    case "heading1":
      context.onChangeBlockType?.(context.blockId, "heading_1");
      return;
    case "heading2":
      context.onChangeBlockType?.(context.blockId, "heading_2");
      return;
    case "heading3":
      context.onChangeBlockType?.(context.blockId, "heading_3");
      return;
    case "bullet":
      context.onChangeBlockType?.(context.blockId, "bullet_list");
      return;
    case "number":
      context.onChangeBlockType?.(context.blockId, "number_list");
      return;
    case "todo":
      context.onChangeBlockType?.(context.blockId, "to_do_list");
      return;
    case "code":
      context.onChangeBlockType?.(context.blockId, "code");
      return;
    case "quote":
      context.onChangeBlockType?.(context.blockId, "quote");
      return;
    case "callout":
      context.onChangeBlockType?.(context.blockId, "callout");
      return;
    case "chat":
      context.onInsertBlock?.("chat_message", context.blockIndex + 1, "");
      return;
    case "divider":
      context.onInsertBlock?.("divider", context.blockIndex);
      return;
    default:
      return;
  }
}

export function getAllSlashCommands(): SlashCommandItem[] {
  return SLASH_COMMAND_REGISTRY.map((command) => ({
    ...command,
    run: (context) => runSlashCommand(command.id, context),
  }));
}

export function buildSlashCommandItems(context: SlashCommandContext): SlashCommandItem[] {
  return getAllSlashCommands().map((cmd) => ({
    ...cmd,
    run: () => cmd.run(context),
  }));
}
