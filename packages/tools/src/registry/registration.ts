/**
 * Tool Registration Hub
 *
 * Registers all Tier 1, 2, 3, and 4 tools into the ToolRegistry.
 */

import type { ToolRegistry, Tool } from "@concurrent/core";
import {
  BrowserNavigateTool,
  BrowserClickTool,
  BrowserTypeTool,
  BrowserExtractTool,
  BrowserScreenshotTool,
  BrowserWaitTool,
  BrowserDownloadTool,
  BrowserSessionManager,
  getSharedBrowserSession,
} from "../browser/index.js";
import {
  FileReadTool,
  FileWriteTool,
  FileListTool,
  FileMoveTool,
  FileDeleteTool,
  FileExistsTool,
} from "../filesystem/index.js";
import { CliExecuteTool } from "../cli/index.js";
import { EmailSendTool, NotifySendTool } from "../communication/index.js";
import { DocumentParseTool, DocumentGenerateTool } from "../documents/index.js";
import { DesktopClickTool, DesktopScreenshotTool } from "../desktop/index.js";

export interface RegisterToolsOptions {
  browserSession?: BrowserSessionManager;
}

export function getAllTools(options: RegisterToolsOptions = {}): Tool[] {
  const session = options.browserSession ?? getSharedBrowserSession();

  return [
    // Tier 1 — Browser
    new BrowserNavigateTool(session),
    new BrowserClickTool(session),
    new BrowserTypeTool(session),
    new BrowserExtractTool(session),
    new BrowserScreenshotTool(session),
    new BrowserWaitTool(session),
    new BrowserDownloadTool(session),

    // Tier 1 — Filesystem
    new FileReadTool(),
    new FileWriteTool(),
    new FileListTool(),
    new FileMoveTool(),
    new FileDeleteTool(),
    new FileExistsTool(),

    // Tier 1 — CLI
    new CliExecuteTool(),

    // Tier 2 — Communication
    new EmailSendTool(),
    new NotifySendTool(),

    // Tier 3 — Documents
    new DocumentParseTool(),
    new DocumentGenerateTool(),

    // Tier 4 — Desktop
    new DesktopClickTool(),
    new DesktopScreenshotTool(),
  ];
}

export function registerAllTools(registry: ToolRegistry, options?: RegisterToolsOptions): void {
  const tools = getAllTools(options);
  for (const tool of tools) {
    if (!registry.has(tool.name)) {
      registry.register(tool);
    }
  }
}
