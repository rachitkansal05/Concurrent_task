/**
 * Task Factory — creates new Task objects with proper defaults.
 */

import { nanoid } from "nanoid";
import type { Task, TaskType, RiskLevel } from "./types/task.js";

export interface CreateTaskOptions {
  /** The raw request string */
  request: string;
  /** Who submitted the request */
  requestedBy?: string;
  /** Optional pre-classified task type */
  type?: TaskType;
  /** Optional pre-assessed risk level */
  riskLevel?: RiskLevel;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Create a new Task with defaults filled in.
 */
export function createTask(options: CreateTaskOptions): Task {
  const now = new Date();

  return {
    id: nanoid(12),
    request: options.request,
    type: options.type ?? "unknown",
    riskLevel: options.riskLevel ?? "medium",
    status: "pending",
    evidence: [],
    requestedBy: options.requestedBy ?? "system",
    metadata: options.metadata ?? {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Generate a unique ID for any entity.
 */
export function generateId(length = 12): string {
  return nanoid(length);
}
