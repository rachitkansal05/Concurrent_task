/**
 * Error Recovery & Self-Healing Engine
 *
 * Classifies failure modes, executes targeted recovery strategies (exponential retry,
 * tool fallback, auth refresh, DOM self-healing), and prevents task crashes.
 */

import { createLogger, ConcurrentError } from "@concurrent/core";

export type FailureCategory =
  | "network_transient"
  | "rate_limit"
  | "auth_expired"
  | "tool_selector_drift"
  | "resource_busy"
  | "permission_denied"
  | "validation_error"
  | "unknown_fatal";

export type RecoveryAction = "retry" | "fallback_tool" | "refresh_auth" | "replan" | "escalate";

export interface RecoveryPlan {
  category: FailureCategory;
  action: RecoveryAction;
  delayMs: number;
  maxAttempts: number;
  fallbackToolName?: string;
  reason: string;
}

export interface ErrorRecoveryConfig {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
  toolFallbacks?: Record<string, string>; // e.g. { "browser.download": "cli.execute" }
}

export class ErrorRecoveryManager {
  private log = createLogger({ component: "error-recovery" });
  private maxRetries: number;
  private initialDelayMs: number;
  private maxDelayMs: number;
  private backoffFactor: number;
  private toolFallbacks: Map<string, string>;

  constructor(config: ErrorRecoveryConfig = {}) {
    this.maxRetries = config.maxRetries ?? 3;
    this.initialDelayMs = config.initialDelayMs ?? 500;
    this.maxDelayMs = config.maxDelayMs ?? 10000;
    this.backoffFactor = config.backoffFactor ?? 2;
    this.toolFallbacks = new Map(Object.entries(config.toolFallbacks || {}));
  }

  /**
   * Classify any caught error into a standardized failure category.
   */
  classifyError(err: unknown): FailureCategory {
    const message = (err instanceof Error ? err.message : String(err)).toLowerCase();

    if (
      message.includes("econnrefused") ||
      message.includes("etimedout") ||
      message.includes("503") ||
      message.includes("502") ||
      message.includes("network error") ||
      message.includes("fetch failed") ||
      message.includes("socket hang up")
    ) {
      return "network_transient";
    }

    if (
      message.includes("429") ||
      message.includes("rate limit") ||
      message.includes("too many requests") ||
      message.includes("quota exceeded")
    ) {
      return "rate_limit";
    }

    if (
      message.includes("401") ||
      message.includes("unauthorized") ||
      message.includes("jwt expired") ||
      message.includes("token expired") ||
      message.includes("session invalid")
    ) {
      return "auth_expired";
    }

    if (
      message.includes("selector") ||
      message.includes("element not found") ||
      message.includes("waiting for locator") ||
      message.includes("dom node missing")
    ) {
      return "tool_selector_drift";
    }

    if (
      message.includes("ebusy") ||
      message.includes("resource lock") ||
      message.includes("database is locked")
    ) {
      return "resource_busy";
    }

    if (
      message.includes("403") ||
      message.includes("forbidden") ||
      message.includes("permission denied")
    ) {
      return "permission_denied";
    }

    if (
      message.includes("invalid parameters") ||
      message.includes("schema validation") ||
      message.includes("bad request")
    ) {
      return "validation_error";
    }

    return "unknown_fatal";
  }

  /**
   * Determine the optimal recovery plan for a step failure given its attempt count.
   */
  determineRecoveryPlan(
    err: unknown,
    currentAttempt: number,
    toolName?: string
  ): RecoveryPlan {
    const category = this.classifyError(err);
    const msg = err instanceof Error ? err.message : String(err);

    // 1. Permission violations or validation errors cannot be solved by blind retry
    if (category === "permission_denied" || category === "validation_error") {
      return {
        category,
        action: "escalate",
        delayMs: 0,
        maxAttempts: 1,
        reason: `Fatal error (${category}): ${msg}. Requires human intervention.`,
      };
    }

    // 2. Exceeded retry attempts
    if (currentAttempt >= this.maxRetries) {
      // Check if fallback tool is available
      if (toolName && this.toolFallbacks.has(toolName)) {
        const fallbackTool = this.toolFallbacks.get(toolName)!;
        return {
          category,
          action: "fallback_tool",
          delayMs: 500,
          maxAttempts: this.maxRetries,
          fallbackToolName: fallbackTool,
          reason: `Exhausted direct retries for "${toolName}". Switching to fallback tool "${fallbackTool}".`,
        };
      }

      return {
        category,
        action: "escalate",
        delayMs: 0,
        maxAttempts: this.maxRetries,
        reason: `Exhausted ${this.maxRetries} retry attempts for category "${category}". Escalating to human.`,
      };
    }

    // 3. Auth expired: attempt refresh
    if (category === "auth_expired") {
      return {
        category,
        action: "refresh_auth",
        delayMs: 1000,
        maxAttempts: this.maxRetries,
        reason: "Detected expired authentication token; triggering session re-auth.",
      };
    }

    // 4. Selector drift: trigger vision/dom replanning
    if (category === "tool_selector_drift") {
      return {
        category,
        action: "replan",
        delayMs: 1500,
        maxAttempts: this.maxRetries,
        reason: "UI target not found; initiating dynamic replanning with visual context.",
      };
    }

    // 5. Transient network or rate limit: exponential backoff with jitter
    const exponentialDelay = this.initialDelayMs * Math.pow(this.backoffFactor, currentAttempt - 1);
    const jitter = Math.floor(Math.random() * 250);
    const calculatedDelay = Math.min(exponentialDelay + jitter, this.maxDelayMs);

    return {
      category,
      action: "retry",
      delayMs: calculatedDelay,
      maxAttempts: this.maxRetries,
      reason: `Transient failure (${category}). Retrying in ${calculatedDelay}ms (attempt ${currentAttempt}/${this.maxRetries}).`,
    };
  }

  /**
   * Execute an operation wrapped in automatic classification and self-healing retries.
   */
  async executeWithRecovery<T>(
    operation: (attempt: number) => Promise<T>,
    options: {
      toolName?: string;
      onRetry?: (plan: RecoveryPlan, attempt: number) => void;
    } = {}
  ): Promise<T> {
    let attempt = 1;

    while (true) {
      try {
        return await operation(attempt);
      } catch (err: unknown) {
        const plan = this.determineRecoveryPlan(err, attempt, options.toolName);

        this.log.warn(
          { attempt, category: plan.category, action: plan.action, delayMs: plan.delayMs },
          plan.reason
        );

        if (options.onRetry) {
          options.onRetry(plan, attempt);
        }

        if (plan.action === "escalate") {
          throw new ConcurrentError("TASK_MAX_RETRIES", `Recovery failed (${plan.category}): ${plan.reason}`, {
            context: { category: plan.category, attempts: attempt, originalError: String(err) },
          });
        }

        // Wait backoff delay
        if (plan.delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, plan.delayMs));
        }

        attempt++;
      }
    }
  }

  registerToolFallback(primaryTool: string, fallbackTool: string): void {
    this.toolFallbacks.set(primaryTool, fallbackTool);
    this.log.info({ primaryTool, fallbackTool }, "Registered tool fallback alternative");
  }
}
