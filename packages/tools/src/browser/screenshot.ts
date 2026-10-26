/**
 * Browser Screenshot Tool
 *
 * Captures visual proof of the web page state and stores as evidence.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { BrowserSessionManager, getSharedBrowserSession } from "./session.js";

const log = createLogger({ component: "browser.screenshot" });

export class BrowserScreenshotTool implements Tool {
  readonly name = "browser.screenshot";
  readonly description = "Capture a screenshot of the active browser page and store as evidence";
  readonly category = "browser";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      name: { type: "string" as const, description: "Descriptive label for this screenshot" },
      fullPage: { type: "boolean" as const, description: "Whether to capture full scrollable page" },
    },
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      filePath: { type: "string" as const },
      url: { type: "string" as const },
      title: { type: "string" as const },
    },
  };

  constructor(private session: BrowserSessionManager = getSharedBrowserSession()) {}

  validate(params: Record<string, unknown>): ValidationResult {
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const label = params.name ? String(params.name) : `step-${context.stepId || 1}`;

    if (context.dryRun) {
      log.info({ label }, "[Dry Run] Capturing screenshot");
      return {
        success: true,
        output: { filePath: `./evidence/${label}-dryrun.png`, url: "https://example.com", title: "Dry Run Page" },
        evidence: [{ type: "screenshot", value: label, path: `./evidence/${label}-dryrun.png`, timestamp: new Date() }],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const page = await this.session.getPage();
      const url = page.url();
      const title = await page.title();

      const screenshot = await this.session.captureScreenshot(label);

      return {
        success: true,
        output: { filePath: screenshot.path, url, title },
        evidence: [
          {
            type: "screenshot",
            value: label,
            path: screenshot.path,
            timestamp: new Date(),
            stepId: context.stepId,
          },
        ],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to capture browser screenshot: ${String(err)}`, {
        context: { label },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
