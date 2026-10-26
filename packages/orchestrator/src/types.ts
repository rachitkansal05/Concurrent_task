/**
 * @concurrent/orchestrator - Domain Types for Multi-Task Orchestration
 */

import type { Plan, Step, Task, TaskStatus, Observation } from "@concurrent/core";

export type TaskPriority = "critical" | "high" | "normal" | "low";

export const PRIORITY_WEIGHTS: Record<TaskPriority, number> = {
  critical: 1,
  high: 2,
  normal: 3,
  low: 4,
};

export type OrchestratorTaskStatus = TaskStatus | "queued" | "waiting_dependencies";

/** Queued task state tracked by the TaskQueue */
export interface QueuedTask {
  task: Task;
  plan?: Plan;
  priority: TaskPriority;
  dependsOn: string[]; // task IDs
  status: OrchestratorTaskStatus;
  queuedAt: string;
  startedAt?: string;
  completedAt?: string;
  output?: Record<string, unknown>;
  error?: string;
}

/** Resource limits configuration */
export interface ResourceLimits {
  /** Maximum number of concurrently executing tasks (default: 3) */
  maxConcurrentTasks: number;
  /** Maximum concurrent browser sessions allowed across all tasks (default: 2) */
  maxBrowserSessions: number;
  /** Maximum tool executions per second across all tasks (default: 10) */
  maxActionsPerSecond: number;
}

/** Function signature for dynamic iterative re-planning */
export type ReplanFunction = (
  task: Task,
  currentPlan: Plan,
  failedOrObservedStep: Step,
  observation: Observation
) => Promise<Plan>;

/** Long-running task evaluation spec */
export interface LongRunningCheckSpec {
  taskId: string;
  checkIntervalMs: number;
  maxDurationMs: number;
  checkAction: (attempt: number) => Promise<{ completed: boolean; output?: Record<string, unknown>; error?: string }>;
}

/** Lifecycle event payloads */
export type OrchestratorEvent =
  | { type: "task:enqueued"; task: QueuedTask }
  | { type: "task:started"; taskId: string }
  | { type: "task:completed"; taskId: string; output?: Record<string, unknown> }
  | { type: "task:failed"; taskId: string; error: string }
  | { type: "task:replanned"; taskId: string; revisedStepsCount: number }
  | { type: "task:waiting_dependencies"; taskId: string; unmet: string[] };

export type OrchestratorEventListener = (event: OrchestratorEvent) => void;
