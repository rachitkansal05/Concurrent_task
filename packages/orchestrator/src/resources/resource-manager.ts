/**
 * Resource Manager & Rate Limiter
 *
 * Enforces hardware and platform limits:
 *   - Concurrent task execution limits
 *   - Concurrent browser session limits
 *   - Token-bucket rate limiting for tool executions / external APIs
 */

import { createLogger } from "@concurrent/core";
import type { ResourceLimits } from "../types.js";

export const DEFAULT_RESOURCE_LIMITS: ResourceLimits = {
  maxConcurrentTasks: 3,
  maxBrowserSessions: 2,
  maxActionsPerSecond: 10,
};

class AsyncSemaphore {
  private currentCount = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.currentCount < this.max) {
      this.currentCount++;
      return;
    }

    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) next();
    } else {
      this.currentCount = Math.max(0, this.currentCount - 1);
    }
  }

  get available(): number {
    return Math.max(0, this.max - this.currentCount);
  }

  get active(): number {
    return this.currentCount;
  }
}

export class ResourceManager {
  private log = createLogger({ component: "resource-manager" });
  readonly limits: ResourceLimits;

  private taskSemaphore: AsyncSemaphore;
  private browserSemaphore: AsyncSemaphore;

  // Rate Limiting (Token Bucket)
  private tokens: number;
  private lastRefillTime: number;

  constructor(limits: Partial<ResourceLimits> = {}) {
    this.limits = { ...DEFAULT_RESOURCE_LIMITS, ...limits };
    this.taskSemaphore = new AsyncSemaphore(this.limits.maxConcurrentTasks);
    this.browserSemaphore = new AsyncSemaphore(this.limits.maxBrowserSessions);

    this.tokens = this.limits.maxActionsPerSecond;
    this.lastRefillTime = Date.now();

    this.log.debug({ limits: this.limits }, "ResourceManager initialized");
  }

  /** Acquire a task execution slot */
  async acquireTaskSlot(): Promise<() => void> {
    await this.taskSemaphore.acquire();
    this.log.debug({ activeTasks: this.taskSemaphore.active }, "Acquired task execution slot");
    return () => this.taskSemaphore.release();
  }

  /** Acquire a browser session slot */
  async acquireBrowserSession(): Promise<() => void> {
    await this.browserSemaphore.acquire();
    this.log.debug({ activeBrowsers: this.browserSemaphore.active }, "Acquired browser session slot");
    return () => this.browserSemaphore.release();
  }

  /** Rate limit an action call (waits if rate limit exceeded) */
  async rateLimit(): Promise<void> {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTime) / 1000;

    // Refill tokens
    this.tokens = Math.min(
      this.limits.maxActionsPerSecond,
      this.tokens + elapsedSeconds * this.limits.maxActionsPerSecond
    );
    this.lastRefillTime = now;

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // Wait until at least 1 token is available
    const waitTimeMs = Math.ceil(((1 - this.tokens) / this.limits.maxActionsPerSecond) * 1000);
    await new Promise((resolve) => setTimeout(resolve, waitTimeMs));
    this.tokens = 0;
  }

  get activeTasks(): number {
    return this.taskSemaphore.active;
  }

  get activeBrowserSessions(): number {
    return this.browserSemaphore.active;
  }
}
