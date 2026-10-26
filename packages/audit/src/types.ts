/**
 * @concurrent/audit - Security, Permissions & Audit Domain Types
 */

import type { RiskLevel } from "@concurrent/core";

// ─────────────────────────────────────────────────────────────────────────────
// DATA CLASSIFICATION
// ─────────────────────────────────────────────────────────────────────────────

export type DataClassificationLevel = "public" | "internal" | "confidential" | "restricted";

export interface DataClassificationResult {
  level: DataClassificationLevel;
  categories: string[]; // e.g. ["ssn", "credentials", "financials"]
  containsRestricted: boolean;
  containsPii: boolean;
  redactedText?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIAL MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

export type CredentialType = "password" | "token" | "api_key" | "certificate" | "oauth2";

export interface StoredCredentialMetadata {
  id: string;
  name: string;
  system: string;
  type: CredentialType;
  username?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedVaultPayload {
  iv: string;
  authTag: string;
  cipherText: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT TRAIL
// ─────────────────────────────────────────────────────────────────────────────

export type AuditActionType =
  | "tool_call"
  | "tool_result"
  | "permission_check"
  | "permission_denied"
  | "approval_decision"
  | "escalation_alert"
  | "credential_access"
  | "plan_generated"
  | "data_classified";

export interface AuditActor {
  type: "agent" | "human" | "system";
  id: string;
  name?: string;
  role?: string;
}

export interface AuditTarget {
  toolName?: string;
  system?: string;
  path?: string;
  url?: string;
}

export interface AuditRecord {
  id: string;
  index: number;
  taskId?: string;
  stepId?: number;
  timestamp: string;
  actionType: AuditActionType;
  actor: AuditActor;
  target: AuditTarget;
  riskLevel?: RiskLevel;
  dataClassification: DataClassificationLevel;
  payload: Record<string, unknown>; // redacted
  previousHash: string; // SHA-256 of preceding audit record
  hash: string; // SHA-256 of current record
}

export interface AuditQueryFilter {
  taskId?: string;
  actionType?: AuditActionType;
  actorId?: string;
  dataClassification?: DataClassificationLevel;
  minRiskLevel?: RiskLevel;
  fromTime?: string;
  toTime?: string;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// NETWORK SECURITY
// ─────────────────────────────────────────────────────────────────────────────

export interface NetworkSecurityPolicy {
  allowedDomains: string[];
  enforceTls: boolean;
  blockedPorts?: number[];
}
