/**
 * Procedure Library
 *
 * Loads structured YAML playbooks from a procedures directory,
 * validates their schema, and provides fuzzy-matching to select
 * the right procedure for a given request.
 *
 * Procedure YAML Format:
 *   See /config/procedures/example.yaml for a reference procedure.
 *
 * Matching Strategy:
 *   - Tokenize request and triggers into lowercase word sets
 *   - Compute Jaccard similarity between request tokens and trigger tokens
 *   - Return all procedures with score > threshold, ranked by score
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createLogger } from "@concurrent/core";
import type { Procedure, ProcedureMatch } from "../types.js";

const log = createLogger({ component: "procedure-library" });

// ─────────────────────────────────────────────────────────────────────────────
// YAML PARSING (inline — avoids mandatory dep if js-yaml unavailable)
// ─────────────────────────────────────────────────────────────────────────────

async function loadYaml(filePath: string): Promise<unknown> {
  // Dynamic import so the package degrades gracefully if js-yaml is missing
  try {
    const { load } = await import("js-yaml");
    const raw = await fs.readFile(filePath, "utf-8");
    return load(raw);
  } catch (err) {
    throw new Error(`Failed to parse YAML at ${filePath}: ${String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────────────────────────

function validateProcedure(raw: unknown, sourcePath: string): Procedure {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`Procedure at ${sourcePath} is not an object`);
  }

  // Handle both `procedure:` wrapper and direct object
  const obj = ("procedure" in (raw as Record<string, unknown>))
    ? (raw as Record<string, unknown>).procedure as Record<string, unknown>
    : raw as Record<string, unknown>;

  if (typeof obj.name !== "string" || !obj.name) {
    throw new Error(`Procedure at ${sourcePath} missing 'name'`);
  }
  if (!Array.isArray(obj.triggers) || obj.triggers.length === 0) {
    throw new Error(`Procedure '${obj.name}' at ${sourcePath} has no 'triggers'`);
  }
  if (!Array.isArray(obj.steps) || obj.steps.length === 0) {
    throw new Error(`Procedure '${obj.name}' at ${sourcePath} has no 'steps'`);
  }

  const steps = (obj.steps as unknown[]).map((s, i) => {
    const step = s as Record<string, unknown>;
    const toolName = (typeof step.tool === "string" && step.tool) || (typeof step.action === "string" && step.action) || "";
    if (!toolName) {
      throw new Error(`Procedure '${obj.name}' step ${i + 1} missing 'tool'`);
    }
    return {
      id: typeof step.id === "number" ? step.id : i + 1,
      description: typeof step.description === "string" ? step.description : `Step ${i + 1}`,
      tool: toolName,
      params: (typeof step.params === "object" && step.params !== null)
        ? step.params as Record<string, unknown>
        : {},
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn as number[] : [],
      requiresApproval: typeof step.requiresApproval === "boolean"
        ? step.requiresApproval
        : false,
    };
  });

  const verification = Array.isArray(obj.verification)
    ? (obj.verification as unknown[]).map((v) => {
        const vobj = v as Record<string, unknown>;
        return {
          check: String(vobj.check ?? ""),
          tool: String(vobj.tool ?? vobj.action ?? ""),
          params: (typeof vobj.params === "object" && vobj.params !== null)
            ? vobj.params as Record<string, unknown>
            : {},
          expected: vobj.expected !== undefined ? String(vobj.expected) : undefined,
        };
      })
    : undefined;

  const validRiskLevels = ["low", "medium", "high", "critical"] as const;
  type RiskLevel = (typeof validRiskLevels)[number];
  const riskLevel: RiskLevel = validRiskLevels.includes(obj.riskLevel as RiskLevel)
    ? (obj.riskLevel as RiskLevel)
    : "medium";

  // Slugify name to produce stable ID
  const id = String(obj.name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return {
    id,
    name: obj.name as string,
    description: typeof obj.description === "string" ? obj.description : "",
    triggers: obj.triggers as string[],
    systems: Array.isArray(obj.systems) ? (obj.systems as string[]) : [],
    steps,
    verification,
    riskLevel,
    sourcePath,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  return new Set(tokens);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return intersection.size / union.size;
}

function scoreProcedureAgainstRequest(
  procedure: Procedure,
  requestTokens: Set<string>,
): number {
  let best = 0;
  for (const trigger of procedure.triggers) {
    const triggerTokens = tokenize(trigger);
    const score = jaccardSimilarity(requestTokens, triggerTokens);
    if (score > best) best = score;
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURE LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

export interface ProcedureLibraryOptions {
  /** Directory containing procedure YAML files */
  proceduresDir: string;
  /** Minimum match confidence to return a procedure (default 0.05) */
  matchThreshold?: number;
}

export class ProcedureLibrary {
  private procedures: Procedure[] = [];

  constructor(private opts: ProcedureLibraryOptions) {}

  /** Load all YAML procedure files from the procedures directory. */
  async load(): Promise<void> {
    const dir = this.opts.proceduresDir;

    if (!fsSync.existsSync(dir)) {
      log.warn({ dir }, "Procedures directory does not exist — no procedures loaded");
      return;
    }

    const entries = await fs.readdir(dir, { recursive: true });
    const yamlFiles = entries
      .map((e) => String(e))
      .filter((e) => /\.(yaml|yml)$/.test(e));

    this.procedures = [];
    let loaded = 0;
    let errors = 0;

    for (const file of yamlFiles) {
      const absPath = path.join(dir, file);
      try {
        const stat = await fs.stat(absPath);
        if (!stat.isFile()) continue;
        const raw = await loadYaml(absPath);
        const procedure = validateProcedure(raw, absPath);
        this.procedures.push(procedure);
        loaded++;
        log.debug({ name: procedure.name, triggers: procedure.triggers.length }, "Procedure loaded");
      } catch (err) {
        errors++;
        log.warn({ file, err: String(err) }, "Failed to load procedure — skipping");
      }
    }

    log.info({ loaded, errors, total: this.procedures.length }, "Procedure library ready");
  }

  /**
   * Find procedures that match the given request.
   *
   * @param request  Natural-language request to match
   * @param topK     Max number of results (default 3)
   */
  match(request: string, topK = 3): ProcedureMatch[] {
    const requestTokens = tokenize(request);
    const threshold = this.opts.matchThreshold ?? 0.05;

    const matches = this.procedures
      .map((proc) => ({
        procedure: proc,
        confidence: scoreProcedureAgainstRequest(proc, requestTokens),
      }))
      .filter((m) => m.confidence >= threshold)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, topK);

    log.debug(
      { request: request.slice(0, 60), found: matches.length },
      "Procedure match completed",
    );

    return matches;
  }

  /** Get a procedure by its slug ID. */
  getById(id: string): Procedure | undefined {
    return this.procedures.find((p) => p.id === id);
  }

  /** List all loaded procedures. */
  list(): Procedure[] {
    return [...this.procedures];
  }

  /** Number of loaded procedures. */
  get count(): number {
    return this.procedures.length;
  }
}
