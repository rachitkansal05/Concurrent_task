/**
 * Browser Wait Tool
 *
 * Waits for a specific selector to appear, change state, or pauses for a duration.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { BrowserSessionManager, getSharedBrowserSession } from "./session.js";

const log = createLogger({ component: "browser.wait" });

export class BrowserWaitTool implements Tool {
  readonly name = "browser.wait";
  readonly description = "Wait for a page element to appear, become visible, or pause for a specified time";
  readonly category = "browser";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      selector: { type: "string" as const, description: "CSS selector to wait for" },
      ms: { type: "number" as const, description: "Duration to pause in milliseconds (default: 1000)" },
      state: {
        type: "string" as const,
        description: "State to wait for: visible, attached, detached, or hidden",
        enum: ["visible", "attached", "detached", "hidden"],
      },
      timeoutMs: { type: "number" as const, description: "Maximum wait timeout in milliseconds" },
    },
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      waitedMs: { type: "number" as const },
      found: { type: "boolean" as const },
    },
  };

  constructor(private session: BrowserSessionManager = getSharedBrowserSession()) {}

  validate(params: Record<string, unknown>): ValidationResult {
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const selector = params.selector ? String(params.selector) : undefined;
    const ms = typeof params.ms === "number" ? params.ms : selector ? 0 : 1000;
    const state = (params.state as "visible" | "attached" | "detached" | "hidden") || "visible";
    const timeout = typeof params.timeoutMs === "number" ? params.timeoutMs : 15000;

    if (context.dryRun) {
      log.info({ selector, ms }, "[Dry Run] Waiting");
      return {
        success: true,
        output: { waitedMs: ms, found: true },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const page = await this.session.getPage();

      if (selector) {
        log.debug({ selector, state }, "Waiting for selector");
        await page.waitForSelector(selector, { state, timeout });
      }

      if (ms > 0) {
        await page.waitForTimeout(ms);
      }

      return {
        success: true,
        output: { waitedMs: Date.now() - startTime, found: true },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Wait condition failed for ${selector || ms + "ms"}: ${String(err)}`, {
        context: { selector, ms },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
