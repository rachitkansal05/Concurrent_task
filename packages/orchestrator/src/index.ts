/**
 * @concurrent/orchestrator
 *
 * Core agent execution loop, plan execution, priority queue scheduling,
 * concurrent task orchestration, and dependency management.
 */

export const ORCHESTRATOR_MODULE_VERSION = "0.2.0";

// Domain Types
export * from "./types.js";

// Plan Execution
export { PlanExecutor, type ExecutionReport } from "./executor.js";

// Task Queue
export { TaskQueue, type TaskQueueOptions } from "./queue/task-queue.js";

// Resource Management & Rate Limiting
export {
  ResourceManager,
  DEFAULT_RESOURCE_LIMITS,
} from "./resources/resource-manager.js";

// Dependency Management
export { DependencyManager } from "./dependencies/dependency-manager.js";

// Dynamic Re-planning
export { IterativeReplanner } from "./replanning/replanner.js";

// Long-running Tasks
export {
  LongRunningManager,
  type LongRunningTaskSession,
} from "./longrunning/long-running-manager.js";

// Unified Multi-Task Orchestrator
export {
  MultiTaskOrchestrator,
  type OrchestratorOptions,
} from "./orchestrator.js";

// Resilience & Self-Healing
export {
  ErrorRecoveryManager,
  type FailureCategory,
  type RecoveryAction,
  type RecoveryPlan,
  type ErrorRecoveryConfig,
} from "./resilience/recovery.js";

// Observability & Telemetry
export {
  MetricsCollector,
  type TaskMetricRecord,
  type MetricsSummary,
} from "./observability/metrics.js";
