/**
 * Browser Extract Tool
 *
 * Extracts text, HTML, or attributes from elements on the active web page.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { BrowserSessionManager, getSharedBrowserSession } from "./session.js";

const log = createLogger({ component: "browser.extract" });

export class BrowserExtractTool implements Tool {
  readonly name = "browser.extract";
  readonly description = "Extract text, attribute values, or inner HTML from elements matching a selector";
  readonly category = "browser";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      selector: { type: "string" as const, description: "CSS selector of element to inspect" },
      attribute: { type: "string" as const, description: "Attribute name (e.g. 'href', 'value'). If omitted, extracts inner text." },
      all: { type: "boolean" as const, description: "If true, extracts matching values from all matched elements as an array" },
    },
    required: ["selector"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      text: { type: "string" as const },
      values: { type: "array" as const },
      count: { type: "number" as const },
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
    const attribute = params.attribute ? String(params.attribute) : undefined;
    const all = Boolean(params.all);

    if (context.dryRun) {
      log.info({ selector }, "[Dry Run] Extracting text");
      return {
        success: true,
        output: { text: "Dry Run Extracted Content", values: ["Dry Run Extracted Content"], count: 1 },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    }

    try {
      const page = await this.session.getPage();

      if (all) {
        const elements = await page.$$(selector);
        const values: string[] = [];
        for (const el of elements) {
          if (attribute) {
            const val = await el.getAttribute(attribute);
            if (val !== null) values.push(val);
          } else {
            const txt = await el.innerText();
            values.push(txt.trim());
          }
        }

        return {
          success: true,
          output: { values, count: values.length, text: values.join("\n") },
          evidence: [{ type: "text", value: values.join("\n"), timestamp: new Date(), stepId: context.stepId }],
          durationMs: Date.now() - startTime,
        };
      }

      // Single element extraction
      const element = await page.$(selector);
      if (!element) {
        throw new ToolError("TOOL_EXECUTION_FAILED", `No element found matching selector "${selector}"`);
      }

      let text: string;
      if (attribute) {
        const val = await element.getAttribute(attribute);
        text = val ?? "";
      } else {
        text = (await element.innerText()).trim();
      }

      return {
        success: true,
        output: { text, count: 1 },
        evidence: [{ type: "text", value: text, timestamp: new Date(), stepId: context.stepId }],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to extract from "${selector}": ${String(err)}`, {
        context: { selector },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
