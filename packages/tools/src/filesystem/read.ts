/**
 * File Read Tool
 *
 * Reads file contents from the local filesystem with sandbox enforcement.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { readFileSync, existsSync, statSync } from "node:fs";
import { PathGuard } from "./security.js";

const log = createLogger({ component: "file.read" });

export class FileReadTool implements Tool {
  readonly name = "file.read";
  readonly description = "Read the contents of a file on the local filesystem";
  readonly category = "filesystem";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Absolute or relative file path" },
      encoding: {
        type: "string" as const,
        description: "File encoding: utf-8 (default) or base64",
        enum: ["utf-8", "base64"],
      },
    },
    required: ["path"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      content: { type: "string" as const },
      size: { type: "number" as const },
      path: { type: "string" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.path || typeof params.path !== "string") {
      return { valid: false, errors: ["'path' parameter is required and must be a string."] };
    }
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawPath = String(params.path);
    const encoding = (params.encoding as BufferEncoding) || "utf-8";

    const resolved = PathGuard.assertAllowed(rawPath, context.allowedPaths);

    if (context.dryRun) {
      log.info({ path: resolved }, "[Dry Run] Reading file");
      return {
        success: true,
        output: { content: "Dry run file content", size: 20, path: resolved },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    }

    if (!existsSync(resolved)) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `File does not exist: "${rawPath}"`, {
        context: { path: rawPath, resolved },
      });
    }

    try {
      const content = readFileSync(resolved, encoding);
      const size = statSync(resolved).size;

      return {
        success: true,
        output: { content, size, path: resolved },
        evidence: [{ type: "file", value: resolved, path: resolved, timestamp: new Date(), stepId: context.stepId }],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to read file "${rawPath}": ${String(err)}`, {
        context: { path: rawPath },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
