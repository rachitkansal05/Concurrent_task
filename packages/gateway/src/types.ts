/**
 * @concurrent/gateway - Domain Types
 *
 * Types for Clarifications, Approvals, Escalations, and Interaction Channels.
 */

import type { RiskLevel } from "@concurrent/core";

// ─────────────────────────────────────────────────────────────────────────────
// CLARIFICATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ClarificationOption {
  id: string;
  label: string;
  value: string;
  description?: string;
}

export type ClarificationStatus = "pending" | "answered" | "timed_out";

export interface ClarificationRequest {
  id: string;
  taskId: string;
  question: string;
  contextDescription?: string;
  options?: ClarificationOption[];
  allowFreeText?: boolean;
  defaultValue?: string;
  timeoutMs?: number;
  createdAt: string;
  status: ClarificationStatus;
  answer?: string;
  answeredBy?: string;
  answeredAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// APPROVAL TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ApprovalDecision = "approved" | "rejected" | "modified";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "modified" | "timed_out";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  stepId?: number;
  actionName: string;
  riskLevel: RiskLevel;
  reason: string;
  parameters: Record<string, unknown>;
  consequences?: string;
  requestedAt: string;
  timeoutMs?: number;
  status: ApprovalStatus;
  decision?: ApprovalDecision;
  decidedBy?: string;
  decidedAt?: string;
  modifiedParameters?: Record<string, unknown>;
  feedbackNote?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ESCALATION TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type EscalationTrigger =
  | "low_confidence"
  | "repeated_failure"
  | "permission_denied"
  | "approval_rejected"
  | "unknown_state"
  | "timeout";

export type EscalationStatus = "open" | "in_review" | "resolved" | "cancelled";

export interface EscalationRoutingTarget {
  userId?: string;
  name?: string;
  email?: string;
  role?: string;
  department?: string;
}

export interface EscalationAttemptRecord {
  stepId: number;
  action: string;
  status: string;
  error?: string;
}

export interface EscalationRequest {
  id: string;
  taskId: string;
  trigger: EscalationTrigger;
  summary: string;
  attemptedSteps: EscalationAttemptRecord[];
  evidenceSummary?: string[];
  suggestedActions: string[];
  assignedTo: EscalationRoutingTarget;
  createdAt: string;
  status: EscalationStatus;
  resolutionNotes?: string;
  resolvedAt?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERACTION CHANNELS
// ─────────────────────────────────────────────────────────────────────────────

export interface InteractionChannel {
  readonly name: string;
  sendApprovalRequest(request: ApprovalRequest): Promise<void>;
  sendClarificationRequest(request: ClarificationRequest): Promise<void>;
  sendEscalationAlert(request: EscalationRequest): Promise<void>;
}
