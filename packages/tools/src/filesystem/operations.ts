/**
 * File List, Move, Delete, and Exists Tools
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { readdirSync, statSync, existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PathGuard } from "./security.js";

const log = createLogger({ component: "file.ops" });

export class FileListTool implements Tool {
  readonly name = "file.list";
  readonly description = "List files and subdirectories in a directory path";
  readonly category = "filesystem";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Directory path to list" },
    },
    required: ["path"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      entries: { type: "array" as const },
      count: { type: "number" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.path || typeof params.path !== "string") {
      return { valid: false, errors: ["'path' parameter is required."] };
    }
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const rawPath = String(params.path);
    const resolved = PathGuard.assertAllowed(rawPath, context.allowedPaths);

    if (!existsSync(resolved)) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Directory does not exist: "${rawPath}"`);
    }

    try {
      const dirents = readdirSync(resolved, { withFileTypes: true });
      const entries = dirents.map((d) => ({
        name: d.name,
        isDirectory: d.isDirectory(),
        size: d.isFile() ? statSync(join(resolved, d.name)).size : 0,
      }));

      return {
        success: true,
        output: { entries, count: entries.length, path: resolved },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to list directory: ${String(err)}`);
    }
  }
}

export class FileMoveTool implements Tool {
  readonly name = "file.move";
  readonly description = "Move or rename a file or directory";
  readonly category = "filesystem";
  readonly riskLevel = "medium";

  readonly parameters = {
    type: "object" as const,
    properties: {
      source: { type: "string" as const, description: "Current file path" },
      destination: { type: "string" as const, description: "New destination path" },
    },
    required: ["source", "destination"],
  };

  readonly returns = {
    type: "object" as const,
    properties: { moved: { type: "boolean" as const } },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!params.source) errors.push("'source' is required");
    if (!params.destination) errors.push("'destination' is required");
    return { valid: errors.length === 0, errors };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const src = PathGuard.assertAllowed(String(params.source), context.allowedPaths);
    const dest = PathGuard.assertAllowed(String(params.destination), context.allowedPaths);

    if (context.dryRun) {
      return { success: true, output: { moved: true, src, dest }, evidence: [], durationMs: 10 };
    }

    if (!existsSync(src)) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Source file does not exist: "${params.source}"`);
    }

    renameSync(src, dest);
    return {
      success: true,
      output: { moved: true, source: src, destination: dest },
      evidence: [{ type: "file", value: dest, path: dest, timestamp: new Date() }],
      durationMs: Date.now() - startTime,
    };
  }
}

export class FileDeleteTool implements Tool {
  readonly name = "file.delete";
  readonly description = "Delete a file or directory permanently";
  readonly category = "filesystem";
  readonly riskLevel = "high";

  readonly parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Path to remove" },
      recursive: { type: "boolean" as const, description: "Recursively remove directories" },
    },
    required: ["path"],
  };

  readonly returns = {
    type: "object" as const,
    properties: { deleted: { type: "boolean" as const } },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.path) return { valid: false, errors: ["'path' parameter is required."] };
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const resolved = PathGuard.assertAllowed(String(params.path), context.allowedPaths);

    if (context.dryRun) {
      log.info({ path: resolved }, "[Dry Run] Deleting file");
      return { success: true, output: { deleted: true, path: resolved }, evidence: [], durationMs: 10 };
    }

    if (!existsSync(resolved)) {
      return { success: true, output: { deleted: false, message: "File already does not exist" }, evidence: [], durationMs: 10 };
    }

    rmSync(resolved, { recursive: Boolean(params.recursive), force: true });
    return {
      success: true,
      output: { deleted: true, path: resolved },
      evidence: [],
      durationMs: Date.now() - startTime,
    };
  }
}

export class FileExistsTool implements Tool {
  readonly name = "file.exists";
  readonly description = "Check if a file or directory exists on the filesystem";
  readonly category = "filesystem";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "File or directory path to check" },
    },
    required: ["path"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      exists: { type: "boolean" as const },
      isFile: { type: "boolean" as const },
      isDirectory: { type: "boolean" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.path) return { valid: false, errors: ["'path' parameter is required."] };
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const resolved = PathGuard.assertAllowed(String(params.path), context.allowedPaths);

    const exists = existsSync(resolved);
    let isFile = false;
    let isDirectory = false;

    if (exists) {
      const stat = statSync(resolved);
      isFile = stat.isFile();
      isDirectory = stat.isDirectory();
    }

    return {
      success: true,
      output: { exists, isFile, isDirectory, path: resolved },
      evidence: [],
      durationMs: Date.now() - startTime,
    };
  }
}
