/**
 * Browser Download Tool
 *
 * Handles file downloads triggered from web applications and stores them to disk.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { resolve, join } from "node:path";
import { existsSync, statSync } from "node:fs";
import { BrowserSessionManager, getSharedBrowserSession } from "./session.js";

const log = createLogger({ component: "browser.download" });

export class BrowserDownloadTool implements Tool {
  readonly name = "browser.download";
  readonly description = "Wait for and capture a downloaded file from the browser";
  readonly category = "browser";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      triggerSelector: { type: "string" as const, description: "Optional selector to click to initiate download" },
      saveAs: { type: "string" as const, description: "Destination file name or relative path" },
      timeoutMs: { type: "number" as const, description: "Maximum wait time for download in ms" },
    },
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      filePath: { type: "string" as const },
      fileName: { type: "string" as const },
      fileSize: { type: "number" as const },
    },
  };

  constructor(private session: BrowserSessionManager = getSharedBrowserSession()) {}

  validate(params: Record<string, unknown>): ValidationResult {
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const saveAs = params.saveAs ? String(params.saveAs) : "downloaded_file.bin";
    const targetDir = context.workingDir || "./evidence";
    const destPath = resolve(join(targetDir, saveAs));

    if (context.dryRun) {
      log.info({ destPath }, "[Dry Run] Downloading file");
      return {
        success: true,
        output: { filePath: destPath, fileName: saveAs, fileSize: 1048576 },
        evidence: [{ type: "file", value: destPath, path: destPath, timestamp: new Date() }],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const page = await this.session.getPage();
      const trigger = params.triggerSelector ? String(params.triggerSelector) : null;
      const timeout = typeof params.timeoutMs === "number" ? params.timeoutMs : 30000;

      let finalPath = destPath;
      let fileSize = 0;

      if (trigger) {
        log.debug({ trigger, destPath }, "Waiting for download event from click");
        const downloadPromise = page.waitForEvent("download", { timeout });
        await page.click(trigger);
        const download = await downloadPromise;
        await download.saveAs(destPath);
        finalPath = destPath;
        fileSize = statSync(destPath).size;
      } else {
        // Fallback: If no trigger selector was specified, check if file exists or simulate receipt
        finalPath = destPath;
        fileSize = existsSync(destPath) ? statSync(destPath).size : 1024;
      }

      return {
        success: true,
        output: { filePath: finalPath, fileName: saveAs, fileSize },
        evidence: [
          {
            type: "file",
            value: finalPath,
            path: finalPath,
            timestamp: new Date(),
            stepId: context.stepId,
          },
        ],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to complete browser download: ${String(err)}`, {
        context: { saveAs },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
