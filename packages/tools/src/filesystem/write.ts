/**
 * File Write Tool
 *
 * Writes text or binary data to disk, ensuring parent directories exist.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { PathGuard } from "./security.js";

const log = createLogger({ component: "file.write" });

export class FileWriteTool implements Tool {
  readonly name = "file.write";
  readonly description = "Write or overwrite content to a file on the local filesystem";
  readonly category = "filesystem";
  readonly riskLevel = "medium";

  readonly parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Target file path" },
      content: { type: "string" as const, description: "Content to write" },
      encoding: {
        type: "string" as const,
        description: "Content encoding: utf-8 (default) or base64",
        enum: ["utf-8", "base64"],
      },
      overwrite: { type: "boolean" as const, description: "Whether to allow overwriting an existing file" },
    },
    required: ["path", "content"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      bytesWritten: { type: "number" as const },
      path: { type: "string" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!params.path || typeof params.path !== "string") {
      errors.push("'path' parameter is required.");
    }
    if (params.content === undefined || params.content === null) {
      errors.push("'content' parameter is required.");
    }
    return { valid: errors.length === 0, errors };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawPath = String(params.path);
    const content = String(params.content);
    const encoding = (params.encoding as BufferEncoding) || "utf-8";
    const allowOverwrite = params.overwrite !== false;

    const resolved = PathGuard.assertAllowed(rawPath, context.allowedPaths);

    if (context.dryRun) {
      log.info({ path: resolved, bytes: Buffer.byteLength(content) }, "[Dry Run] Writing file");
      return {
        success: true,
        output: { bytesWritten: Buffer.byteLength(content), path: resolved },
        evidence: [{ type: "file", value: resolved, path: resolved, timestamp: new Date() }],
        durationMs: Date.now() - startTime,
      };
    }

    if (existsSync(resolved) && !allowOverwrite) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `File already exists and overwrite is set to false: "${rawPath}"`);
    }

    try {
      const parentDir = dirname(resolved);
      if (!existsSync(parentDir)) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(resolved, content, encoding);
      const bytesWritten = Buffer.byteLength(content, encoding);

      return {
        success: true,
        output: { bytesWritten, path: resolved },
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
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to write to file "${rawPath}": ${String(err)}`, {
        context: { path: rawPath },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
