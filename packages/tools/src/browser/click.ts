/**
 * Browser Click Tool
 *
 * Clicks an interactive element on the active web page.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { BrowserSessionManager, getSharedBrowserSession } from "./session.js";

const log = createLogger({ component: "browser.click" });

export class BrowserClickTool implements Tool {
  readonly name = "browser.click";
  readonly description = "Click an element matching the given CSS or text selector on the active web page";
  readonly category = "browser";
  readonly riskLevel = "medium";

  readonly parameters = {
    type: "object" as const,
    properties: {
      selector: { type: "string" as const, description: "CSS selector or text selector, e.g. '#submit-btn' or 'text=Sign In'" },
      wait: { type: "boolean" as const, description: "Wait for navigation after click" },
      timeoutMs: { type: "number" as const, description: "Maximum wait time in milliseconds" },
    },
    required: ["selector"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      clicked: { type: "boolean" as const },
      selector: { type: "string" as const },
    },
  };

  constructor(private session: BrowserSessionManager = getSharedBrowserSession()) {}

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.selector || typeof params.selector !== "string") {
      return { valid: false, errors: ["'selector' parameter is required and must be a string."] };
    }
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const selector = String(params.selector);

    if (context.dryRun) {
      log.info({ selector }, "[Dry Run] Clicking element");
      return {
        success: true,
        output: { clicked: true, selector },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const page = await this.session.getPage();
      const timeout = typeof params.timeoutMs === "number" ? params.timeoutMs : 10000;

      log.debug({ selector, wait: params.wait }, "Clicking element on page");

      if (params.wait) {
        await Promise.all([
          page.waitForLoadState("load", { timeout }).catch(() => {}),
          page.click(selector, { timeout }),
        ]);
      } else {
        await page.click(selector, { timeout });
      }

      return {
        success: true,
        output: { clicked: true, selector },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to click selector "${selector}": ${String(err)}`, {
        context: { selector },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
