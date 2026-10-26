/**
 * Escalation Protocol Engine
 *
 * Handles task escalations when confidence is low, errors repeat,
 * or unknown states occur. Routes to the right person/team and captures
 * human feedback for future procedure improvement.
 */

import { createLogger, generateId } from "@concurrent/core";
import type {
  EscalationAttemptRecord,
  EscalationRequest,
  EscalationRoutingTarget,
  EscalationStatus,
  EscalationTrigger,
} from "../types.js";
import type { ChannelManager } from "../channels/channel.js";

export interface CreateEscalationParams {
  taskId: string;
  trigger: EscalationTrigger;
  summary: string;
  attemptedSteps?: EscalationAttemptRecord[];
  evidenceSummary?: string[];
  suggestedActions?: string[];
  assignedTo?: EscalationRoutingTarget;
}

export interface HumanCorrectionRecord {
  taskId: string;
  escalationId: string;
  originalFailure: string;
  correctionApplied: string;
  procedureHint?: string;
  capturedAt: string;
}

export class EscalationEngine {
  private log = createLogger({ component: "escalation-engine" });
  private escalations: Map<string, EscalationRequest> = new Map();
  private correctionsLog: HumanCorrectionRecord[] = [];

  constructor(private channelManager?: ChannelManager) {}

  /** Create an escalation and alert assigned parties */
  async escalate(params: CreateEscalationParams): Promise<EscalationRequest> {
    const id = generateId();
    const assignedTo: EscalationRoutingTarget = params.assignedTo || {
      role: "System Operator",
      name: "Default Operator",
    };

    const request: EscalationRequest = {
      id,
      taskId: params.taskId,
      trigger: params.trigger,
      summary: params.summary,
      attemptedSteps: params.attemptedSteps || [],
      evidenceSummary: params.evidenceSummary,
      suggestedActions: params.suggestedActions || [
        "Review step execution logs and failure reason",
        "Inspect target system availability",
        "Provide manual input or override step parameters",
      ],
      assignedTo,
      createdAt: new Date().toISOString(),
      status: "open",
    };

    this.escalations.set(id, request);
    this.log.warn(
      {
        escalationId: id,
        taskId: params.taskId,
        trigger: params.trigger,
        assignedTo: assignedTo.name || assignedTo.role,
      },
      "Task escalated to human operator"
    );

    // Broadcast escalation across channels
    if (this.channelManager) {
      await this.channelManager.broadcastEscalation(request);
    }

    return request;
  }

  /** Resolve an escalation with notes and correction learning */
  resolve(
    escalationId: string,
    options: {
      resolutionNotes: string;
      procedureImprovementHint?: string;
      resolvedBy?: string;
    }
  ): boolean {
    const request = this.escalations.get(escalationId);
    if (!request || request.status === "resolved") {
      this.log.warn({ escalationId }, "Cannot resolve nonexistent or already resolved escalation");
      return false;
    }

    request.status = "resolved";
    request.resolutionNotes = options.resolutionNotes;
    request.resolvedAt = new Date().toISOString();

    // Log human correction for future procedure improvement
    const correction: HumanCorrectionRecord = {
      taskId: request.taskId,
      escalationId,
      originalFailure: request.summary,
      correctionApplied: options.resolutionNotes,
      procedureHint: options.procedureImprovementHint,
      capturedAt: new Date().toISOString(),
    };
    this.correctionsLog.push(correction);

    this.log.info(
      {
        escalationId,
        taskId: request.taskId,
        resolvedBy: options.resolvedBy || "operator",
        hasProcedureHint: Boolean(options.procedureImprovementHint),
      },
      "Escalation resolved and correction logged"
    );

    return true;
  }

  /** Get escalation by ID */
  get(escalationId: string): EscalationRequest | undefined {
    return this.escalations.get(escalationId);
  }

  /** List all active/open escalations */
  listOpen(): EscalationRequest[] {
    return Array.from(this.escalations.values()).filter((e) => e.status === "open" || e.status === "in_review");
  }

  /** Get all logged human corrections (for procedure improvement) */
  getCorrectionsLog(): HumanCorrectionRecord[] {
    return [...this.correctionsLog];
  }
}
