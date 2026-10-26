/**
 * Browser Type Tool
 *
 * Enters text into an input or textarea element on the active web page.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { BrowserSessionManager, getSharedBrowserSession } from "./session.js";

const log = createLogger({ component: "browser.type" });

export class BrowserTypeTool implements Tool {
  readonly name = "browser.type";
  readonly description = "Enter text into an input field or textarea on the active web page";
  readonly category = "browser";
  readonly riskLevel = "medium";

  readonly parameters = {
    type: "object" as const,
    properties: {
      selector: { type: "string" as const, description: "CSS or text selector of input field" },
      text: { type: "string" as const, description: "Text string to input" },
      clear: { type: "boolean" as const, description: "Whether to clear existing text before entering" },
    },
    required: ["selector", "text"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      typed: { type: "boolean" as const },
      selector: { type: "string" as const },
      characters: { type: "number" as const },
    },
  };

  constructor(private session: BrowserSessionManager = getSharedBrowserSession()) {}

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!params.selector || typeof params.selector !== "string") {
      errors.push("'selector' parameter is required and must be a string.");
    }
    if (params.text === undefined || params.text === null) {
      errors.push("'text' parameter is required.");
    }
    return { valid: errors.length === 0, errors };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const selector = String(params.selector);
    const text = String(params.text);

    if (context.dryRun) {
      log.info({ selector, textLength: text.length }, "[Dry Run] Typing into field");
      return {
        success: true,
        output: { typed: true, selector, characters: text.length },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const page = await this.session.getPage();

      if (params.clear) {
        await page.fill(selector, "");
      }

      await page.fill(selector, text);

      return {
        success: true,
        output: { typed: true, selector, characters: text.length },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to type into "${selector}": ${String(err)}`, {
        context: { selector },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
