/**
 * Document Generate Tool
 *
 * Fills templates and generates reports in text, CSV, or markdown format.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { PathGuard } from "../filesystem/security.js";

const log = createLogger({ component: "document.generate" });

export class DocumentGenerateTool implements Tool {
  readonly name = "document.generate";
  readonly description = "Generate a formatted document or report by populating a template with data values";
  readonly category = "documents";
  readonly riskLevel = "medium";

  readonly parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Output document path" },
      template: { type: "string" as const, description: "Template string containing {{variable}} placeholders" },
      data: { type: "object" as const, description: "Key-value map of variables to substitute" },
    },
    required: ["path", "template", "data"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const },
      bytesWritten: { type: "number" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!params.path) errors.push("'path' parameter is required.");
    if (!params.template) errors.push("'template' parameter is required.");
    if (!params.data || typeof params.data !== "object") errors.push("'data' parameter is required.");
    return { valid: errors.length === 0, errors };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawPath = String(params.path);
    const template = String(params.template);
    const data = params.data as Record<string, unknown>;

    const resolved = PathGuard.assertAllowed(rawPath, context.allowedPaths);

    // Perform template substitution
    let populated = template;
    for (const [key, val] of Object.entries(data)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      populated = populated.replace(regex, String(val));
    }

    if (context.dryRun) {
      return {
        success: true,
        output: { path: resolved, bytesWritten: Buffer.byteLength(populated) },
        evidence: [{ type: "file", value: resolved, path: resolved, timestamp: new Date() }],
        durationMs: 5,
      };
    }

    try {
      const parentDir = dirname(resolved);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(resolved, populated, "utf-8");

      return {
        success: true,
        output: { path: resolved, bytesWritten: Buffer.byteLength(populated) },
        evidence: [
          {
            type: "file",
            value: resolved,
            path: resolved,
            timestamp: new Date(),
            stepId: context.stepId,
          },
        ],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to generate document: ${String(err)}`);
    }
  }
}
