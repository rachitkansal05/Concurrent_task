/**
 * Approval Workflow Engine
 *
 * Manages human approval for high-risk actions (external email, deletions,
 * financial transactions, shell commands).
 * Supports approve, reject, and modify (parameter overrides).
 */

import { createLogger, generateId, type RiskLevel } from "@concurrent/core";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
} from "../types.js";
import type { ChannelManager } from "../channels/channel.js";

export interface RequestApprovalParams {
  taskId: string;
  stepId?: number;
  actionName: string;
  riskLevel: RiskLevel;
  reason: string;
  parameters: Record<string, unknown>;
  consequences?: string;
  timeoutMs?: number;
}

export interface ApprovalOutcome {
  decision: ApprovalDecision;
  approved: boolean;
  modifiedParameters?: Record<string, unknown>;
  decidedBy: string;
  feedbackNote?: string;
}

export class ApprovalWorkflow {
  private log = createLogger({ component: "approval-workflow" });
  private pendingApprovals: Map<
    string,
    {
      request: ApprovalRequest;
      resolve: (outcome: ApprovalOutcome) => void;
      timer?: NodeJS.Timeout;
    }
  > = new Map();
  private auditHistory: ApprovalRequest[] = [];

  constructor(private channelManager?: ChannelManager) {}

  /** Request approval for an action and pause until human decision or timeout */
  async requestApproval(params: RequestApprovalParams): Promise<ApprovalOutcome> {
    const id = generateId();
    const request: ApprovalRequest = {
      id,
      taskId: params.taskId,
      stepId: params.stepId,
      actionName: params.actionName,
      riskLevel: params.riskLevel,
      reason: params.reason,
      parameters: params.parameters,
      consequences: params.consequences,
      requestedAt: new Date().toISOString(),
      timeoutMs: params.timeoutMs,
      status: "pending",
    };

    this.log.warn(
      {
        requestId: id,
        taskId: params.taskId,
        action: params.actionName,
        risk: params.riskLevel,
      },
      "Pausing for explicit human approval"
    );

    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;

      if (params.timeoutMs && params.timeoutMs > 0) {
        timer = setTimeout(() => {
          this.handleTimeout(id);
        }, params.timeoutMs);
      }

      this.pendingApprovals.set(id, {
        request,
        resolve,
        timer,
      });

      // Broadcast across all registered channels (CLI, Web, Chat)
      if (this.channelManager) {
        this.channelManager.broadcastApproval(request).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.error({ err: msg }, "Error broadcasting approval to channels");
        });
      }
    });
  }

  /** Decide on a pending approval (approve / reject / modify) */
  decide(
    requestId: string,
    decision: ApprovalDecision,
    options: {
      modifiedParameters?: Record<string, unknown>;
      decidedBy?: string;
      feedbackNote?: string;
    } = {}
  ): boolean {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending || pending.request.status !== "pending") {
      this.log.warn({ requestId }, "Attempted decision on nonexistent or resolved approval");
      return false;
    }

    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    const decidedBy = options.decidedBy || "human-operator";
    pending.request.status = decision;
    pending.request.decision = decision;
    pending.request.decidedBy = decidedBy;
    pending.request.decidedAt = new Date().toISOString();
    pending.request.modifiedParameters = options.modifiedParameters;
    pending.request.feedbackNote = options.feedbackNote;

    this.auditHistory.push(pending.request);
    this.pendingApprovals.delete(requestId);

    const approved = decision === "approved" || decision === "modified";
    this.log.info(
      {
        requestId,
        decision,
        approved,
        decidedBy,
        modified: Boolean(options.modifiedParameters),
      },
      "Approval decision recorded"
    );

    pending.resolve({
      decision,
      approved,
      modifiedParameters: options.modifiedParameters,
      decidedBy,
      feedbackNote: options.feedbackNote,
    });

    return true;
  }

  /** Helper to quickly approve a request */
  approve(requestId: string, decidedBy?: string, note?: string): boolean {
    return this.decide(requestId, "approved", { decidedBy, feedbackNote: note });
  }

  /** Helper to quickly reject a request */
  reject(requestId: string, decidedBy?: string, reason?: string): boolean {
    return this.decide(requestId, "rejected", { decidedBy, feedbackNote: reason });
  }

  /** Helper to modify parameters and approve */
  modify(
    requestId: string,
    modifiedParameters: Record<string, unknown>,
    decidedBy?: string,
    note?: string
  ): boolean {
    return this.decide(requestId, "modified", {
      modifiedParameters,
      decidedBy,
      feedbackNote: note,
    });
  }

  /** List pending approval requests */
  listPending(): ApprovalRequest[] {
    return Array.from(this.pendingApprovals.values()).map((p) => p.request);
  }

  /** Get an approval request by ID */
  get(requestId: string): ApprovalRequest | undefined {
    return this.pendingApprovals.get(requestId)?.request || this.auditHistory.find((r) => r.id === requestId);
  }

  /** Get complete audit trail of approval requests */
  getAuditHistory(): ApprovalRequest[] {
    return [...this.auditHistory];
  }

  private handleTimeout(requestId: string): void {
    const pending = this.pendingApprovals.get(requestId);
    if (!pending || pending.request.status !== "pending") return;

    pending.request.status = "timed_out";
    pending.request.decision = "rejected";
    pending.request.decidedBy = "system-timeout";
    pending.request.decidedAt = new Date().toISOString();
    pending.request.feedbackNote = "Approval window expired without human response.";

    this.auditHistory.push(pending.request);
    this.pendingApprovals.delete(requestId);

    this.log.warn({ requestId }, "Approval timed out — default rejected");
    pending.resolve({
      decision: "rejected",
      approved: false,
      decidedBy: "system-timeout",
      feedbackNote: "Approval request timed out",
    });
  }
}
