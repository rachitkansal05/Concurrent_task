/**
 * Browser Navigate Tool
 *
 * Navigates the browser to a destination URL and captures proof of navigation.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { BrowserSessionManager, getSharedBrowserSession } from "./session.js";

const log = createLogger({ component: "browser.navigate" });

export class BrowserNavigateTool implements Tool {
  readonly name = "browser.navigate";
  readonly description = "Navigate web browser to a specified URL and wait for page load";
  readonly category = "browser";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      url: { type: "string" as const, description: "Destination URL (http:// or https://)" },
      waitUntil: {
        type: "string" as const,
        description: "Navigation lifecycle event: load, domcontentloaded, or networkidle",
        enum: ["load", "domcontentloaded", "networkidle"],
      },
    },
    required: ["url"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      status: { type: "number" as const },
      url: { type: "string" as const },
      title: { type: "string" as const },
    },
  };

  constructor(private session: BrowserSessionManager = getSharedBrowserSession()) {}

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.url || typeof params.url !== "string") {
      return { valid: false, errors: ["'url' parameter is required and must be a string."] };
    }

    try {
      const parsed = new URL(params.url);
      if (!["http:", "https:", "data:", "file:"].includes(parsed.protocol)) {
        return { valid: false, errors: [`Unsupported protocol "${parsed.protocol}".`] };
      }
    } catch {
      return { valid: false, errors: [`Invalid URL string "${params.url}".`] };
    }

    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const url = String(params.url);

    // Permission check against allowedDomains
    const allowed = context.allowedDomains?.length ? context.allowedDomains : undefined;
    if (allowed && !this.session.isDomainAllowed(url)) {
      throw new ToolError(
        "TOOL_PERMISSION_DENIED",
        `Navigation to domain "${url}" is not permitted by domain policy.`,
        { context: { url, allowedDomains: allowed } },
      );
    }

    if (context.dryRun) {
      log.info({ url }, "[Dry Run] Navigating to URL");
      return {
        success: true,
        output: { status: 200, url, title: "Dry Run Page" },
        evidence: [{ type: "url", value: url, timestamp: new Date() }],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const page = await this.session.getPage();
      const waitUntil = (params.waitUntil as "load" | "domcontentloaded" | "networkidle") || "load";

      log.debug({ url, waitUntil }, "Navigating page");
      const response = await page.goto(url, { waitUntil });

      const finalUrl = page.url();
      const title = await page.title();
      const status = response ? response.status() : 200;

      // Capture screenshot evidence
      const screenshot = await this.session.captureScreenshot(`step-${context.stepId || 1}-nav`);

      return {
        success: true,
        output: { status, url: finalUrl, title },
        evidence: [
          { type: "url", value: finalUrl, timestamp: new Date(), stepId: context.stepId },
          { type: "screenshot", value: title, path: screenshot.path, timestamp: new Date(), stepId: context.stepId },
        ],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to navigate to ${url}: ${String(err)}`, {
        context: { url },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
