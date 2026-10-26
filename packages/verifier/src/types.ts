/**
 * @concurrent/verifier - Core Types
 *
 * Types for post-conditions, verification results, evidence bundles,
 * and confidence scoring.
 */

import type { Evidence, EvidenceType } from "@concurrent/core";

export type { Evidence, EvidenceType };

/** Supported post-condition verification check types */
export type PostConditionType =
  | "file_exists"
  | "file_hash"
  | "file_size"
  | "file_contains"
  | "http_status"
  | "http_json_field"
  | "dom_element_present"
  | "dom_text_contains"
  | "data_matches_pattern"
  | "data_field_equals"
  | "custom";

/** Post-condition rule definition */
export interface PostCondition {
  id: string;
  name: string;
  type: PostConditionType;
  description?: string;
  /** Importance weight from 0.0 to 1.0 (default: 1.0) */
  weight?: number;
  /** If true, failure of this condition fails the entire verification */
  critical?: boolean;
  /** Parameters specific to the condition type */
  params: Record<string, unknown>;
}

/** Result of an individual condition check */
export interface ConditionCheckResult {
  conditionId: string;
  name: string;
  type: PostConditionType | "llm_evaluation";
  passed: boolean;
  /** Score from 0.0 (total failure) to 1.0 (perfect match) */
  score: number;
  weight: number;
  critical: boolean;
  message: string;
  evidenceId?: string;
  details?: Record<string, unknown>;
  durationMs: number;
}

/** Overall status of task outcome verification */
export type VerificationStatus = "passed" | "failed" | "needs_review" | "skipped";

/** Configuration thresholds for scoring */
export interface ConfidenceThresholds {
  /** Minimum score to achieve 'passed' status (default: 0.85) */
  passThreshold: number;
  /** Minimum score to qualify for 'needs_review' vs 'failed' (default: 0.60) */
  reviewThreshold: number;
}

/** Rich evidence item bundled with SHA-256 and metadata */
export interface EvidenceItem {
  id: string;
  type: EvidenceType;
  value: string;
  path?: string;
  sha256?: string;
  sizeBytes?: number;
  contentType?: string;
  stepId?: number;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

/** Structured evidence bundle manifest stored to disk */
export interface EvidenceBundle {
  taskId: string;
  bundledAt: string;
  bundleDir: string;
  manifestPath: string;
  items: EvidenceItem[];
  summary: {
    totalCount: number;
    byType: Record<string, number>;
  };
}

/** Final comprehensive verification report */
export interface TaskVerificationReport {
  taskId: string;
  status: VerificationStatus;
  overallConfidence: number;
  passedCount: number;
  failedCount: number;
  totalChecks: number;
  criticalFailure: boolean;
  results: ConditionCheckResult[];
  evidenceBundle: EvidenceBundle;
  verifiedAt: string;
  summary: string;
}

/** Context provided to condition check evaluators */
export interface CheckContext {
  taskId: string;
  workingDir?: string;
  stepOutputs?: Record<number, Record<string, unknown>>;
  evidenceList: EvidenceItem[];
  customData?: Record<string, unknown>;
}

/** Abstract interface for LLM calls during verification */
export interface VerifierLLMClient {
  complete(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<{ content: string }>;
}

/** LLM Verification Specification */
export interface LLMVerificationSpec {
  conditionId: string;
  name: string;
  prompt: string;
  expectedCriteria: string[];
  contextData: Record<string, unknown>;
  weight?: number;
  critical?: boolean;
}
