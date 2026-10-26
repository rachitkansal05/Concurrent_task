/**
 * Permission Model
 *
 * Evaluates whether a tool action is allowed, requires human approval,
 * or is denied. Rules are evaluated in order; first match wins.
 *
 * Permission Policy is loaded from config/permissions.yaml.
 *
 * Rule Evaluation:
 *   1. Check risk-level rules first (if action risk matches)
 *   2. Walk through toolPattern rules in order (glob-style match)
 *   3. Fall back to defaultLevel
 *
 * Pattern matching:
 *   - "browser.*"         → matches any browser.X action
 *   - "email.send"        → exact match
 *   - "filesystem.delete" → exact match
 *   - "*"                 → matches everything
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import { createLogger } from "@concurrent/core";
import type { RiskLevel } from "@concurrent/core";
import type { PermissionPolicy, ToolPermission, PermissionCheckResult } from "../types.js";

const log = createLogger({ component: "permission-model" });

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT POLICY (safe defaults — medium+ requires approval)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POLICY: PermissionPolicy = {
  name: "default",
  defaultLevel: "require_approval",
  rules: [
    {
      toolPattern: "browser.navigate",
      level: "allow",
      reason: "Read-only navigation is safe",
    },
    {
      toolPattern: "browser.extract",
      level: "allow",
      reason: "Data extraction is read-only",
    },
    {
      toolPattern: "browser.screenshot",
      level: "allow",
      reason: "Screenshots are read-only",
    },
    {
      toolPattern: "filesystem.read",
      level: "allow",
      reason: "Read-only file access is safe",
    },
    {
      toolPattern: "filesystem.list",
      level: "allow",
      reason: "Directory listing is read-only",
    },
    {
      toolPattern: "filesystem.exists",
      level: "allow",
      reason: "Existence check is read-only",
    },
    {
      toolPattern: "filesystem.delete",
      level: "require_approval",
      reason: "Deletion requires explicit approval",
    },
    {
      toolPattern: "email.send",
      level: "require_approval",
      reason: "Sending external email requires approval",
    },
    {
      toolPattern: "cli.execute",
      level: "require_approval",
      reason: "Shell command execution requires approval",
    },
    {
      toolPattern: "desktop.*",
      level: "require_approval",
      reason: "Desktop automation requires approval",
    },
  ],
  riskLevelRules: {
    low: "allow",
    medium: "allow",
    high: "require_approval",
    critical: "require_approval",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// YAML LOADING
// ─────────────────────────────────────────────────────────────────────────────

async function loadYaml(filePath: string): Promise<unknown> {
  const { load } = await import("js-yaml");
  const raw = await fs.readFile(filePath, "utf-8");
  return load(raw);
}

function parsePolicy(raw: Record<string, unknown>): PermissionPolicy {
  const validLevels = ["allow", "require_approval", "deny"] as const;
  type Level = (typeof validLevels)[number];

  const defaultLevel: Level = validLevels.includes(raw.defaultLevel as Level)
    ? (raw.defaultLevel as Level)
    : "require_approval";

  const rules: ToolPermission[] = Array.isArray(raw.rules)
    ? (raw.rules as Record<string, unknown>[]).map((r) => ({
        toolPattern: String(r.toolPattern ?? "*"),
        level: validLevels.includes(r.level as Level) ? (r.level as Level) : "require_approval",
        condition: r.condition !== undefined ? String(r.condition) : undefined,
        reason: r.reason !== undefined ? String(r.reason) : undefined,
      }))
    : [];

  const rlRaw = (raw.riskLevelRules ?? {}) as Record<string, unknown>;
  const validApproveLevels = ["allow", "require_approval", "deny"] as const;

  return {
    name: typeof raw.name === "string" ? raw.name : "loaded-policy",
    defaultLevel,
    rules,
    riskLevelRules: {
      low: validApproveLevels.includes(rlRaw.low as Level)
        ? (rlRaw.low as "allow" | "require_approval")
        : "allow",
      medium: validApproveLevels.includes(rlRaw.medium as Level)
        ? (rlRaw.medium as "allow" | "require_approval")
        : "allow",
      high: validApproveLevels.includes(rlRaw.high as Level)
        ? (rlRaw.high as "require_approval" | "deny")
        : "require_approval",
      critical: validApproveLevels.includes(rlRaw.critical as Level)
        ? (rlRaw.critical as "require_approval" | "deny")
        : "require_approval",
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN MATCHING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Match a tool name against a permission pattern.
 * Supports exact match, prefix.* wildcards, and * (match all).
 */
function matchPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === toolName) return true;
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -2);
    return toolName.startsWith(prefix + ".");
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION EVALUATOR
// ─────────────────────────────────────────────────────────────────────────────

export interface PermissionModelOptions {
  /** Path to permissions YAML. Falls back to DEFAULT_POLICY if not found. */
  policyFilePath?: string;
}

export class PermissionModel {
  private policy: PermissionPolicy = DEFAULT_POLICY;

  constructor(private opts: PermissionModelOptions = {}) {}

  /** Load policy from YAML. Uses DEFAULT_POLICY as fallback. */
  async load(): Promise<void> {
    const filePath = this.opts.policyFilePath;

    if (!filePath || !fsSync.existsSync(filePath)) {
      log.info("Using default permission policy (no policy YAML found)");
      this.policy = DEFAULT_POLICY;
      return;
    }

    try {
      const raw = await loadYaml(filePath) as Record<string, unknown>;
      this.policy = parsePolicy(raw);
      log.info(
        { name: this.policy.name, rules: this.policy.rules.length },
        "Permission policy loaded from YAML",
      );
    } catch (err) {
      log.warn({ err: String(err) }, "Failed to load permission policy; using defaults");
      this.policy = DEFAULT_POLICY;
    }
  }

  /**
   * Check whether a tool action is permitted.
   *
   * @param toolName   The tool action name, e.g. "browser.navigate"
   * @param riskLevel  Risk level of the overall task
   * @param params     Tool parameters (for condition evaluation — future use)
   */
  check(
    toolName: string,
    riskLevel: RiskLevel = "low",
    _params: Record<string, unknown> = {},
  ): PermissionCheckResult {
    // 1. Risk-level rules
    const riskRule = this.policy.riskLevelRules[riskLevel];
    if (riskRule === "deny") {
      const result: PermissionCheckResult = {
        toolName,
        allowed: false,
        requiresApproval: false,
        reason: `Risk level '${riskLevel}' is denied by policy`,
      };
      log.debug(result, "Permission denied (risk level)");
      return result;
    }

    // 2. Walk explicit tool rules (first match wins)
    for (const rule of this.policy.rules) {
      if (matchPattern(toolName, rule.toolPattern)) {
        const allowed = rule.level !== "deny";
        const requiresApproval = rule.level === "require_approval";
        const result: PermissionCheckResult = {
          toolName,
          allowed,
          requiresApproval,
          reason: rule.reason ?? `Matched rule: ${rule.toolPattern} → ${rule.level}`,
          matchedRule: rule,
        };
        log.debug(result, "Permission checked (rule match)");
        return result;
      }
    }

    // 3. Combine risk-level rule with default
    const effectiveLevel =
      riskRule === "require_approval" ? "require_approval" : this.policy.defaultLevel;

    const allowed = effectiveLevel !== "deny";
    const requiresApproval = effectiveLevel === "require_approval";
    const result: PermissionCheckResult = {
      toolName,
      allowed,
      requiresApproval,
      reason: `Default policy: ${effectiveLevel}`,
    };

    log.debug(result, "Permission checked (default policy)");
    return result;
  }

  /**
   * Check a batch of tool actions.
   * Returns a map of toolName → PermissionCheckResult.
   */
  checkBatch(
    tools: Array<{ toolName: string; riskLevel: RiskLevel; params?: Record<string, unknown> }>,
  ): Map<string, PermissionCheckResult> {
    const results = new Map<string, PermissionCheckResult>();
    for (const { toolName, riskLevel, params } of tools) {
      results.set(toolName, this.check(toolName, riskLevel, params ?? {}));
    }
    return results;
  }

  /**
   * Get all tools from a list that require human approval.
   */
  filterRequiresApproval(
    tools: Array<{ toolName: string; riskLevel: RiskLevel }>,
  ): string[] {
    return tools
      .filter(({ toolName, riskLevel }) => this.check(toolName, riskLevel).requiresApproval)
      .map(({ toolName }) => toolName);
  }

  /** The loaded policy. */
  getPolicy(): PermissionPolicy {
    return this.policy;
  }
}
