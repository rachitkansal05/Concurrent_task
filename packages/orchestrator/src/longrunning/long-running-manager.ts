/**
 * Long-Running & Periodic Task Manager
 *
 * Manages tasks that poll, monitor, and alert over extended durations
 * with checkpoints, cancellation tokens, and timeout handling.
 */

import { createLogger, generateId } from "@concurrent/core";
import type { LongRunningCheckSpec } from "../types.js";

export interface LongRunningTaskSession {
  id: string;
  taskId: string;
  spec: LongRunningCheckSpec;
  status: "running" | "completed" | "timed_out" | "cancelled";
  startedAt: string;
  completedAt?: string;
  attempts: number;
  lastOutput?: Record<string, unknown>;
  error?: string;
}

export class LongRunningManager {
  private log = createLogger({ component: "long-running-manager" });
  private activeSessions: Map<string, { session: LongRunningTaskSession; timer?: NodeJS.Timeout }> = new Map();

  /** Start a long-running monitor task */
  async startMonitor(
    spec: LongRunningCheckSpec,
    onProgress?: (session: LongRunningTaskSession) => void
  ): Promise<LongRunningTaskSession> {
    const id = generateId();
    const startTime = Date.now();

    const session: LongRunningTaskSession = {
      id,
      taskId: spec.taskId,
      spec,
      status: "running",
      startedAt: new Date().toISOString(),
      attempts: 0,
    };

    this.log.info({ sessionId: id, taskId: spec.taskId }, "Starting long-running monitor");

    return new Promise((resolve) => {
      const poll = async () => {
        session.attempts++;
        const elapsed = Date.now() - startTime;

        try {
          const result = await spec.checkAction(session.attempts);
          session.lastOutput = result.output;

          if (result.completed) {
            session.status = "completed";
            session.completedAt = new Date().toISOString();
            this.activeSessions.delete(id);
            this.log.info({ sessionId: id, attempts: session.attempts }, "Long-running monitor completed successfully");
            resolve(session);
            return;
          }

          if (result.error) {
            session.error = result.error;
          }
        } catch (err: unknown) {
          session.error = err instanceof Error ? err.message : String(err);
        }

        if (onProgress) {
          onProgress(session);
        }

        // Check if exceeded max duration
        if (elapsed >= spec.maxDurationMs) {
          session.status = "timed_out";
          session.completedAt = new Date().toISOString();
          this.activeSessions.delete(id);
          this.log.warn({ sessionId: id, elapsed }, "Long-running monitor timed out");
          resolve(session);
          return;
        }

        // Schedule next poll interval
        const timer = setTimeout(poll, spec.checkIntervalMs);
        this.activeSessions.set(id, { session, timer });
      };

      // Kick off first check immediately
      poll();
    });
  }

  /** Cancel a running monitor session */
  cancel(sessionId: string): boolean {
    const entry = this.activeSessions.get(sessionId);
    if (!entry) return false;

    if (entry.timer) clearTimeout(entry.timer);
    entry.session.status = "cancelled";
    entry.session.completedAt = new Date().toISOString();
    this.activeSessions.delete(sessionId);

    this.log.info({ sessionId }, "Long-running monitor cancelled");
    return true;
  }

  /** Get active session by ID */
  getSession(sessionId: string): LongRunningTaskSession | undefined {
    return this.activeSessions.get(sessionId)?.session;
  }

  /** List all active sessions */
  listActive(): LongRunningTaskSession[] {
    return Array.from(this.activeSessions.values()).map((e) => e.session);
  }
}
