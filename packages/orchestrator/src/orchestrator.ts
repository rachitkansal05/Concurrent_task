/**
 * Multi-Task Orchestrator
 *
 * Coordinates concurrent task execution, priority queue scheduling,
 * cross-task dependency resolution, dynamic re-planning, and resource limits.
 */

import {
  createLogger,
  createTask,
  generateId,
  type Task,
  type Plan,
  type ToolRegistry,
} from "@concurrent/core";
import { TaskQueue, TaskQueueOptions } from "./queue/task-queue.js";
import { ResourceManager } from "./resources/resource-manager.js";
import { DependencyManager } from "./dependencies/dependency-manager.js";
import { IterativeReplanner } from "./replanning/replanner.js";
import { LongRunningManager } from "./longrunning/long-running-manager.js";
import { PlanExecutor, type ExecutionReport } from "./executor.js";
import type {
  OrchestratorEvent,
  OrchestratorEventListener,
  QueuedTask,
  ReplanFunction,
  ResourceLimits,
  TaskPriority,
} from "./types.js";

export interface OrchestratorOptions {
  resourceLimits?: Partial<ResourceLimits>;
  queueOptions?: TaskQueueOptions;
  replanFn?: ReplanFunction;
}

export class MultiTaskOrchestrator {
  private log = createLogger({ component: "multi-task-orchestrator" });
  readonly queue: TaskQueue;
  readonly resources: ResourceManager;
  readonly dependencies: DependencyManager;
  readonly replanner: IterativeReplanner;
  readonly longRunning: LongRunningManager;
  readonly executor: PlanExecutor;

  private listeners: Set<OrchestratorEventListener> = new Set();
  private completedTaskIds: Set<string> = new Set();
  private activeExecutions: Map<string, Promise<ExecutionReport>> = new Map();

  private toolRegistry: ToolRegistry;

  constructor(
    registryOrOptions: ToolRegistry | ({ toolRegistry: ToolRegistry; maxConcurrentTasks?: number } & OrchestratorOptions),
    options: OrchestratorOptions = {}
  ) {
    let registry: ToolRegistry;
    let resolvedOptions: OrchestratorOptions = { ...options };

    if ("register" in registryOrOptions && typeof (registryOrOptions as ToolRegistry).register === "function") {
      registry = registryOrOptions as ToolRegistry;
    } else {
      const opts = registryOrOptions as { toolRegistry: ToolRegistry; maxConcurrentTasks?: number } & OrchestratorOptions;
      registry = opts.toolRegistry;
      resolvedOptions = { ...opts };
      if (opts.maxConcurrentTasks) {
        resolvedOptions.resourceLimits = {
          ...resolvedOptions.resourceLimits,
          maxConcurrentTasks: opts.maxConcurrentTasks,
        };
      }
    }

    this.toolRegistry = registry;
    this.queue = new TaskQueue(resolvedOptions.queueOptions);
    this.resources = new ResourceManager(resolvedOptions.resourceLimits);
    this.dependencies = new DependencyManager();
    this.replanner = new IterativeReplanner(resolvedOptions.replanFn);
    this.longRunning = new LongRunningManager();
    this.executor = new PlanExecutor(registry);

    this.log.info("MultiTaskOrchestrator initialized");
  }

  /** Subscribe to orchestrator lifecycle events */
  subscribe(listener: OrchestratorEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: OrchestratorEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err: unknown) {
        this.log.warn({ err: String(err) }, "Event listener error");
      }
    }
  }

  /** Submit a task into the orchestrator queue */
  async submitTask(params: {
    task: Task;
    plan?: Plan;
    priority?: TaskPriority;
    dependsOn?: string[];
  }): Promise<QueuedTask> {
    const queued = await this.queue.enqueue(params);
    this.emit({ type: "task:enqueued", task: queued });
    return queued;
  }

  /** Alias for submitTask supporting direct title & plan arguments */
  async enqueueTask(params: {
    title?: string;
    task?: Task;
    plan?: Plan;
    priority?: TaskPriority;
    dependsOn?: string[];
  }): Promise<QueuedTask> {
    const taskObj: Task = params.task || createTask({
      request: params.title || "Untitled Task",
    });

    return this.submitTask({
      task: taskObj,
      plan: params.plan,
      priority: params.priority,
      dependsOn: params.dependsOn,
    });
  }

  /** Run orchestrator loop and return array of ExecutionReports */
  async run(options: Parameters<MultiTaskOrchestrator["processAll"]>[0] = {}): Promise<ExecutionReport[]> {
    const map = await this.processAll(options);
    return Array.from(map.values());
  }

  /**
   * Run the dispatch loop until all queued tasks are processed.
   */
  async processAll(options: {
    dryRun?: boolean;
    workingDir?: string;
    allowedPaths?: string[];
    allowedDomains?: string[];
  } = {}): Promise<Map<string, ExecutionReport>> {
    const reports = new Map<string, ExecutionReport>();
    this.log.info("Starting orchestrator processing loop");

    while (true) {
      // Check if any dependencies failed for waiting tasks
      for (const item of this.queue.list()) {
        if (item.status === "waiting_dependencies" && this.dependencies.hasFailedDependency(item.dependsOn)) {
          await this.queue.markFailed(item.task.id, "One or more parent task dependencies failed.");
          this.emit({ type: "task:failed", taskId: item.task.id, error: "Dependency failure" });
        }
      }

      // Check if we can dispatch next task within concurrency limit
      const nextItem = this.queue.getNextRunnableTask(this.completedTaskIds);

      if (nextItem && this.resources.activeTasks < this.resources.limits.maxConcurrentTasks) {
        // Dispatch task concurrently
        const releaseSlot = await this.resources.acquireTaskSlot();
        await this.queue.markRunning(nextItem.task.id);
        this.emit({ type: "task:started", taskId: nextItem.task.id });

        const taskPromise = this.runSingleTask(nextItem, options)
          .then((report) => {
            reports.set(nextItem.task.id, report);
            return report;
          })
          .finally(() => {
            releaseSlot();
            this.activeExecutions.delete(nextItem.task.id);
          });

        this.activeExecutions.set(nextItem.task.id, taskPromise);
        continue;
      }

      // If active tasks are running, wait for at least one to finish before checking queue again
      if (this.activeExecutions.size > 0) {
        await Promise.race(this.activeExecutions.values());
        continue;
      }

      // No active executions and no runnable tasks left -> check if any tasks are still waiting or blocked
      const remaining = this.queue.list().filter(
        (t) => t.status === "queued" || t.status === "waiting_dependencies"
      );

      if (remaining.length === 0) {
        break; // All tasks finished!
      } else {
        // Deadlock or unresolvable dependencies
        for (const item of remaining) {
          await this.queue.markFailed(item.task.id, "Unresolvable dependency or missing parent task.");
          this.emit({ type: "task:failed", taskId: item.task.id, error: "Unresolvable dependency" });
        }
        break;
      }
    }

    this.log.info({ totalReports: reports.size }, "All orchestrator tasks processed");
    return reports;
  }

  /** Run a single task through the PlanExecutor with output piping & replanning */
  private async runSingleTask(
    item: QueuedTask,
    options: {
      dryRun?: boolean;
      workingDir?: string;
      allowedPaths?: string[];
      allowedDomains?: string[];
    }
  ): Promise<ExecutionReport> {
    const { task } = item;
    let plan = item.plan || task.plan;

    if (!plan) {
      const errMsg = `No plan provided for task ${task.id}`;
      await this.queue.markFailed(task.id, errMsg);
      this.emit({ type: "task:failed", taskId: task.id, error: errMsg });
      return {
        taskId: task.id,
        success: false,
        stepsCompleted: 0,
        totalSteps: 0,
        durationMs: 0,
        evidence: [],
        error: errMsg,
      };
    }

    // Pipe parent outputs into child task plan
    if (item.dependsOn.length > 0) {
      plan = this.dependencies.pipeOutputsIntoPlan(plan, item.dependsOn);
    }

    // Apply rate limiter before executing
    await this.resources.rateLimit();

    const report = await this.executor.executePlan(task, plan, {
      dryRun: options.dryRun ?? false,
      workingDir: options.workingDir ?? "./evidence",
      allowedPaths: options.allowedPaths,
      allowedDomains: options.allowedDomains,
    });

    if (report.success) {
      // Gather outputs from completed steps
      const lastStepOutput = plan.steps[plan.steps.length - 1]?.output || {};
      this.completedTaskIds.add(task.id);
      this.dependencies.recordTaskCompletion(task.id, lastStepOutput);
      await this.queue.markCompleted(task.id, lastStepOutput);
      this.emit({ type: "task:completed", taskId: task.id, output: lastStepOutput });
    } else {
      this.dependencies.recordTaskFailure(task.id);
      await this.queue.markFailed(task.id, report.error || "Execution failed");
      this.emit({ type: "task:failed", taskId: task.id, error: report.error || "Execution failed" });
    }

    return report;
  }
}
