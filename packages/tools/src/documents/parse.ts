/**
 * Document Parse Tool
 *
 * Extracts structured data and text from documents (CSV, JSON, plaintext, tables).
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { readFileSync, existsSync } from "node:fs";
import { extname } from "node:path";
import { PathGuard } from "../filesystem/security.js";

const log = createLogger({ component: "document.parse" });

export class DocumentParseTool implements Tool {
  readonly name = "document.parse";
  readonly description = "Parse structured records and tabular data from CSV, JSON, or text documents";
  readonly category = "documents";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      path: { type: "string" as const, description: "Path to document" },
      format: {
        type: "string" as const,
        description: "Document format: csv, json, text (inferred from extension if omitted)",
        enum: ["csv", "json", "text"],
      },
    },
    required: ["path"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      records: { type: "array" as const },
      recordCount: { type: "number" as const },
      columns: { type: "array" as const },
      text: { type: "string" as const },
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

    if (context.dryRun) {
      return {
        success: true,
        output: { records: [{ id: 1, sample: "value" }], recordCount: 1, columns: ["id", "sample"], text: "" },
        evidence: [],
        durationMs: 5,
      };
    }

    if (!existsSync(resolved)) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Document file does not exist: "${rawPath}"`);
    }

    try {
      const content = readFileSync(resolved, "utf-8");
      const ext = extname(resolved).toLowerCase().replace(".", "");
      const format = (params.format as string) || (ext === "csv" ? "csv" : ext === "json" ? "json" : "text");

      let records: unknown[] = [];
      let columns: string[] = [];

      if (format === "json") {
        const parsed = JSON.parse(content);
        records = Array.isArray(parsed) ? parsed : [parsed];
        if (records.length > 0 && typeof records[0] === "object" && records[0] !== null) {
          columns = Object.keys(records[0] as Record<string, unknown>);
        }
      } else if (format === "csv") {
        const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
        if (lines.length > 0) {
          columns = lines[0].split(",").map((c) => c.trim().replace(/^["']|["']$/g, ""));
          for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(",").map((v) => v.trim().replace(/^["']|["']$/g, ""));
            const record: Record<string, string> = {};
            columns.forEach((col, idx) => {
              record[col] = values[idx] ?? "";
            });
            records.push(record);
          }
        }
      }

      return {
        success: true,
        output: {
          records,
          recordCount: records.length,
          columns,
          text: content.slice(0, 2000), // excerpt
        },
        evidence: [
          {
            type: "text",
            value: `Parsed ${records.length} records with columns [${columns.join(", ")}] from ${rawPath}`,
            timestamp: new Date(),
            stepId: context.stepId,
          },
        ],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Failed to parse document "${rawPath}": ${String(err)}`);
    }
  }
}
