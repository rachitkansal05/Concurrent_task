/**
 * Prioritized Persistent Task Queue
 *
 * Supports task priorities (critical > high > normal > low), dependency awareness,
 * state persistence to disk, and concurrency safe operations.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { createLogger, type Task, type Plan } from "@concurrent/core";
import {
  PRIORITY_WEIGHTS,
  type QueuedTask,
  type TaskPriority,
} from "../types.js";

export interface TaskQueueOptions {
  persistencePath?: string;
}

export class TaskQueue {
  private log = createLogger({ component: "task-queue" });
  private tasks: Map<string, QueuedTask> = new Map();
  private persistencePath?: string;

  constructor(options: TaskQueueOptions = {}) {
    this.persistencePath = options.persistencePath;
  }

  /** Enqueue a task with priority and optional dependencies */
  async enqueue(params: {
    task: Task;
    plan?: Plan;
    priority?: TaskPriority;
    dependsOn?: string[];
  }): Promise<QueuedTask> {
    const priority = params.priority || "normal";
    const dependsOn = params.dependsOn || [];
    const hasUnmetDependencies = dependsOn.length > 0;

    const queuedItem: QueuedTask = {
      task: params.task,
      plan: params.plan,
      priority,
      dependsOn,
      status: hasUnmetDependencies ? "waiting_dependencies" : "queued",
      queuedAt: new Date().toISOString(),
    };

    this.tasks.set(params.task.id, queuedItem);
    this.log.info(
      { taskId: params.task.id, priority, dependsOn, status: queuedItem.status },
      "Task enqueued"
    );

    await this.persist();
    return queuedItem;
  }

  /** Peek at the next runnable task without removing it */
  getNextRunnableTask(completedTaskIds: Set<string>): QueuedTask | undefined {
    const candidates: QueuedTask[] = [];

    for (const item of this.tasks.values()) {
      if (item.status === "queued" || item.status === "waiting_dependencies") {
        // Check if all dependencies are satisfied
        const allDepsSatisfied = item.dependsOn.every((depId) => completedTaskIds.has(depId));
        if (allDepsSatisfied) {
          item.status = "queued";
          candidates.push(item);
        }
      }
    }

    if (candidates.length === 0) return undefined;

    // Sort by priority weight ascending (1 is critical, 4 is low), then queuedAt ascending (FIFO)
    candidates.sort((a, b) => {
      const weightDiff = PRIORITY_WEIGHTS[a.priority] - PRIORITY_WEIGHTS[b.priority];
      if (weightDiff !== 0) return weightDiff;
      return new Date(a.queuedAt).getTime() - new Date(b.queuedAt).getTime();
    });

    return candidates[0];
  }

  /** Mark a task as running */
  async markRunning(taskId: string): Promise<QueuedTask | undefined> {
    const item = this.tasks.get(taskId);
    if (!item) return undefined;

    item.status = "executing";
    item.startedAt = new Date().toISOString();
    await this.persist();
    return item;
  }

  /** Mark a task as completed with output */
  async markCompleted(taskId: string, output?: Record<string, unknown>): Promise<QueuedTask | undefined> {
    const item = this.tasks.get(taskId);
    if (!item) return undefined;

    item.status = "completed";
    item.completedAt = new Date().toISOString();
    item.output = output;
    await this.persist();
    return item;
  }

  /** Mark a task as failed */
  async markFailed(taskId: string, error: string): Promise<QueuedTask | undefined> {
    const item = this.tasks.get(taskId);
    if (!item) return undefined;

    item.status = "failed";
    item.completedAt = new Date().toISOString();
    item.error = error;
    await this.persist();
    return item;
  }

  /** Get queued task by ID */
  get(taskId: string): QueuedTask | undefined {
    return this.tasks.get(taskId);
  }

  /** List all tasks in the queue */
  list(): QueuedTask[] {
    return Array.from(this.tasks.values());
  }

  /** Get count of currently executing tasks */
  runningCount(): number {
    return Array.from(this.tasks.values()).filter((t) => t.status === "executing").length;
  }

  /** Persist snapshot to disk if configured */
  private async persist(): Promise<void> {
    if (!this.persistencePath) return;

    try {
      await fs.mkdir(path.dirname(this.persistencePath), { recursive: true });
      const serialized = JSON.stringify(Array.from(this.tasks.values()), null, 2);
      await fs.writeFile(this.persistencePath, serialized, "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn({ path: this.persistencePath, err: msg }, "Failed to persist task queue snapshot");
    }
  }

  /** Load snapshot from disk if exists */
  async loadSnapshot(): Promise<void> {
    if (!this.persistencePath) return;

    try {
      const raw = await fs.readFile(this.persistencePath, "utf-8");
      const list: QueuedTask[] = JSON.parse(raw);
      for (const item of list) {
        this.tasks.set(item.task.id, item);
      }
      this.log.info({ count: list.length }, "Loaded task queue snapshot from disk");
    } catch {
      // no snapshot exists yet
    }
  }
}
