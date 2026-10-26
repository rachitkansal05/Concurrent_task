/**
 * Task — The unit of work in Concurrent.
 *
 * A Task represents a single user request from intake to completion.
 * It tracks the request, its plan, execution status, and evidence.
 */

export type TaskStatus =
  | "pending"     // Received, not yet processed
  | "planning"    // LLM is generating a plan
  | "reviewing"   // Plan generated, awaiting human review/approval
  | "executing"   // Steps are being executed
  | "verifying"   // Execution done, verifying outcome
  | "completed"   // Successfully completed with evidence
  | "failed"      // Failed after retries exhausted
  | "escalated"   // Handed off to a human
  | "cancelled";  // Cancelled by user or system

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type TaskType =
  | "data_retrieval"       // Fetch information from a system
  | "form_filling"         // Fill and submit a form
  | "document_generation"  // Create or modify a document
  | "communication"        // Send email, message, notification
  | "approval_workflow"    // Route something for approval
  | "monitoring"           // Watch for a condition and alert
  | "file_operation"       // Move, copy, convert files
  | "composite"            // Multi-type task
  | "unknown";             // Classifier couldn't determine

export interface Task {
  /** Unique task identifier */
  id: string;

  /** Raw natural-language request from the user */
  request: string;

  /** Expanded version of the request with implicit context filled in */
  expandedRequest?: string;

  /** Classified task type */
  type: TaskType;

  /** Assessed risk level */
  riskLevel: RiskLevel;

  /** Current status */
  status: TaskStatus;

  /** The execution plan (set after planning phase) */
  plan?: Plan;

  /** Evidence collected during/after execution */
  evidence: Evidence[];

  /** Overall confidence score (0-1) after verification */
  confidence?: number;

  /** Error message if failed */
  error?: string;

  /** User or system that submitted the request */
  requestedBy: string;

  /** Metadata — extensible key-value pairs */
  metadata: Record<string, unknown>;

  /** Timestamps */
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

/**
 * Plan — An ordered sequence of Steps to complete a Task.
 */
export type PlanStatus =
  | "draft"       // Generated, not yet approved
  | "approved"    // Approved for execution
  | "executing"   // Currently being executed
  | "completed"   // All steps completed
  | "failed"      // One or more steps failed beyond retry
  | "replanning"; // Being revised after a failure

export interface Plan {
  /** ID of the task this plan belongs to */
  taskId: string;

  /** Ordered list of steps */
  steps: Step[];

  /** Current status */
  status: PlanStatus;

  /** Number of times this plan has been revised */
  revision: number;

  /** Timestamp of plan creation */
  createdAt: Date;
}

/**
 * Step — A single atomic action within a Plan.
 *
 * Each step maps to exactly one Tool call.
 */
export type StepStatus =
  | "pending"   // Not yet started
  | "running"   // Currently executing
  | "success"   // Completed successfully
  | "failed"    // Failed (may be retried)
  | "skipped"   // Skipped (dependency failed or condition not met)
  | "waiting";  // Waiting for human input/approval

export interface Step {
  /** Step ID (unique within the plan, typically sequential: 1, 2, 3...) */
  id: number;

  /** Tool action to invoke, e.g., "browser.navigate", "email.send" */
  action: string;

  /** Parameters to pass to the tool */
  params: Record<string, unknown>;

  /** IDs of steps this step depends on (must complete first) */
  dependsOn: number[];

  /** Human-readable description of what this step does */
  description: string;

  /** Human-readable expected outcome */
  expected: string;

  /** Current status */
  status: StepStatus;

  /** Output returned by the tool after execution */
  output?: Record<string, unknown>;

  /** Evidence collected during this step */
  evidence: Evidence[];

  /** Error message if failed */
  error?: string;

  /** Number of retry attempts made */
  retryCount: number;

  /** Max retries allowed for this step */
  maxRetries: number;

  /** Timestamps */
  startedAt?: Date;
  completedAt?: Date;
}

/**
 * Evidence — Proof of an action or outcome.
 *
 * Collected at each step and bundled at the task level.
 */
export type EvidenceType =
  | "screenshot"        // Screenshot image
  | "file"              // File created/modified
  | "api_response"      // HTTP response data
  | "confirmation_id"   // Confirmation/reference number
  | "url"               // URL visited or resulting
  | "text"              // Extracted text content
  | "log"               // Log entry
  | "hash";             // File hash for integrity

export interface Evidence {
  /** Type of evidence */
  type: EvidenceType;

  /** The evidence value (text, ID, URL, etc.) */
  value: string;

  /** File path if the evidence is stored on disk (screenshots, files) */
  path?: string;

  /** When this evidence was collected */
  timestamp: Date;

  /** Which step produced this evidence (optional — task-level evidence has no step) */
  stepId?: number;
}

/**
 * Observation — What the agent "sees" after executing a tool.
 *
 * This is the structured result that feeds back into the planner's
 * reasoning loop (Reason → Act → Observe).
 */
export interface Observation {
  /** The step that produced this observation */
  stepId: number;

  /** Whether the tool call succeeded */
  success: boolean;

  /** Structured output from the tool */
  output: Record<string, unknown>;

  /** Evidence collected */
  evidence: Evidence[];

  /** Human-readable summary of what happened */
  summary: string;

  /** Error details if the tool call failed */
  error?: string;

  /** Timestamp */
  timestamp: Date;
}
