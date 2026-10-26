/**
 * Permission Enforcer
 *
 * Checks every tool execution against permission rules, enforces security boundaries,
 * and automatically logs denied actions to the immutable audit trail.
 */

import { createLogger, type RiskLevel } from "@concurrent/core";
import type { ImmutableAuditTrail } from "../audit/trail.js";

export interface PermissionRule {
  id?: string;
  toolPattern?: string; // e.g. "file.delete", "cli.*", "*"
  targetRole?: string;
  action?: "allow" | "require_approval" | "deny";
  allowedActions?: string[];
  forbiddenActions?: string[];
  conditions?: Record<string, unknown>;
  reason?: string;
  maxRiskLevel?: RiskLevel;
}

export interface PermissionEvaluationResult {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export class PermissionEnforcer {
  private log = createLogger({ component: "permission-enforcer" });
  private rules: PermissionRule[] = [];
  private auditTrail?: ImmutableAuditTrail;

  constructor(
    optionsOrAudit?: ImmutableAuditTrail | { rules?: PermissionRule[]; auditTrail?: ImmutableAuditTrail },
    initialRules: PermissionRule[] = []
  ) {
    if (optionsOrAudit && "rules" in optionsOrAudit) {
      this.auditTrail = optionsOrAudit.auditTrail;
      this.rules = [...(optionsOrAudit.rules || []), ...initialRules];
    } else {
      this.auditTrail = optionsOrAudit as ImmutableAuditTrail | undefined;
      this.rules = [...initialRules];
    }
  }

  addRule(rule: PermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * Check permissions synchronously or asynchronously.
   */
  checkPermission(params: {
    toolName?: string;
    action?: string;
    actorRole?: string;
    actorId?: string;
    riskLevel?: RiskLevel;
    taskId?: string;
    stepId?: number;
    parameters?: Record<string, unknown>;
  }): PermissionEvaluationResult {
    const actionName = params.action || params.toolName || "unknown";
    const actorRole = params.actorRole || "agent";
    const actorId = params.actorId || "agent-worker";

    // 1. Check explicit forbidden / allowed rule list
    for (const rule of this.rules) {
      if (rule.targetRole && rule.targetRole !== "*" && rule.targetRole !== actorRole) {
        continue;
      }

      // Check forbidden actions
      if (rule.forbiddenActions && rule.forbiddenActions.includes(actionName)) {
        const reason = rule.reason || `Forbidden action "${actionName}" blocked by rule "${rule.id || "deny-rule"}"`;
        this.recordDenial(actionName, actorId, reason, params);
        return { allowed: false, requiresApproval: false, reason };
      }

      // Check tool pattern if specified
      if (rule.toolPattern && this.matchesToolPattern(rule.toolPattern, actionName)) {
        if (rule.action === "deny") {
          const reason = rule.reason || `Action "${actionName}" denied by pattern "${rule.toolPattern}"`;
          this.recordDenial(actionName, actorId, reason, params);
          return { allowed: false, requiresApproval: false, reason };
        }
        if (rule.action === "require_approval") {
          return { allowed: true, requiresApproval: true, reason: rule.reason || "Requires human approval" };
        }
      }
    }

    // Default policy
    const requiresApproval = params.riskLevel === "high" || params.riskLevel === "critical";
    return {
      allowed: true,
      requiresApproval,
      reason: "Action permitted under active security policy",
    };
  }

  /** Alias for checkPermission with async compatibility */
  async evaluate(params: Parameters<PermissionEnforcer["checkPermission"]>[0]): Promise<PermissionEvaluationResult> {
    return this.checkPermission(params);
  }

  private recordDenial(
    actionName: string,
    actorId: string,
    reason: string,
    params: Parameters<PermissionEnforcer["checkPermission"]>[0]
  ): void {
    this.log.warn({ action: actionName, reason }, "Permission violation: action DENIED");
    if (this.auditTrail) {
      this.auditTrail.record({
        eventType: "permission_denied",
        actionType: "permission_denied",
        actor: { type: "agent", id: actorId },
        action: actionName,
        status: "denied",
        target: { toolName: actionName },
        taskId: params.taskId,
        stepId: params.stepId,
        riskLevel: params.riskLevel || "high",
        details: {
          reason,
          parameters: params.parameters,
        },
      });
    }
  }

  private matchesToolPattern(pattern: string, toolName: string): boolean {
    if (pattern === "*") return true;
    if (pattern === toolName) return true;
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2);
      return toolName.startsWith(prefix + ".");
    }
    return false;
  }
}
