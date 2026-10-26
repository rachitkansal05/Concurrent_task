/**
 * Error Taxonomy for Concurrent
 *
 * All errors in the system extend ConcurrentError.
 * Each error type has a unique code and structured context
 * for debugging and error handling.
 *
 * Error Codes:
 *   PLAN_*        — Planning phase errors
 *   TOOL_*        — Tool execution errors
 *   CONFIG_*      — Configuration errors
 *   CONTEXT_*     — Context engine errors
 *   VERIFY_*      — Verification errors
 *   AUTH_*        — Authentication/authorization errors
 *   ESCALATION_*  — Escalation-related errors
 */

export type ErrorCode =
  // Planning errors
  | "PLAN_GENERATION_FAILED"
  | "PLAN_VALIDATION_FAILED"
  | "PLAN_STEP_INVALID"
  | "PLAN_TOOL_NOT_FOUND"
  | "PLAN_DEPENDENCY_CYCLE"
  // Tool execution errors
  | "TOOL_EXECUTION_FAILED"
  | "TOOL_TIMEOUT"
  | "TOOL_VALIDATION_FAILED"
  | "TOOL_NOT_REGISTERED"
  | "TOOL_PERMISSION_DENIED"
  // Config errors
  | "CONFIG_LOAD_FAILED"
  | "CONFIG_VALIDATION_FAILED"
  | "CONFIG_MISSING_REQUIRED"
  // Context errors
  | "CONTEXT_PROCEDURE_NOT_FOUND"
  | "CONTEXT_ENTITY_NOT_FOUND"
  | "CONTEXT_INDEX_FAILED"
  // Verification errors
  | "VERIFY_POSTCONDITION_FAILED"
  | "VERIFY_CONFIDENCE_LOW"
  | "VERIFY_EVIDENCE_MISSING"
  // Auth errors
  | "AUTH_CREDENTIALS_MISSING"
  | "AUTH_TOKEN_EXPIRED"
  | "AUTH_PERMISSION_DENIED"
  // Escalation errors
  | "ESCALATION_TIMEOUT"
  | "ESCALATION_REJECTED"
  // General
  | "TASK_CANCELLED"
  | "TASK_MAX_RETRIES"
  | "UNKNOWN_ERROR";

/**
 * Base error class for all Concurrent errors.
 * Includes a machine-readable code and structured context.
 */
export class ConcurrentError extends Error {
  /** Machine-readable error code */
  readonly code: ErrorCode;

  /** Structured context for debugging */
  readonly context: Record<string, unknown>;

  /** Whether this error is retryable */
  readonly retryable: boolean;

  /** The original error, if this wraps another error */
  readonly cause?: Error;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      context?: Record<string, unknown>;
      retryable?: boolean;
      cause?: Error;
    } = {},
  ) {
    super(message);
    this.name = "ConcurrentError";
    this.code = code;
    this.context = options.context ?? {};
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;

    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ConcurrentError);
    }
  }

  /** Serialize for logging */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      retryable: this.retryable,
      stack: this.stack,
      cause: this.cause?.message,
    };
  }
}

/** Planning phase errors */
export class PlanError extends ConcurrentError {
  constructor(
    code: ErrorCode,
    message: string,
    options: { context?: Record<string, unknown>; cause?: Error } = {},
  ) {
    super(code, message, { ...options, retryable: true });
    this.name = "PlanError";
  }
}

/** Tool execution errors */
export class ToolError extends ConcurrentError {
  constructor(
    code: ErrorCode,
    message: string,
    options: {
      context?: Record<string, unknown>;
      retryable?: boolean;
      cause?: Error;
    } = {},
  ) {
    super(code, message, { retryable: true, ...options });
    this.name = "ToolError";
  }
}

/** Configuration errors (never retryable) */
export class ConfigError extends ConcurrentError {
  constructor(
    code: ErrorCode,
    message: string,
    options: { context?: Record<string, unknown>; cause?: Error } = {},
  ) {
    super(code, message, { ...options, retryable: false });
    this.name = "ConfigError";
  }
}

/** Permission/auth errors (never retryable) */
export class AuthError extends ConcurrentError {
  constructor(
    code: ErrorCode,
    message: string,
    options: { context?: Record<string, unknown>; cause?: Error } = {},
  ) {
    super(code, message, { ...options, retryable: false });
    this.name = "AuthError";
  }
}

/**
 * Wrap an unknown error into a ConcurrentError.
 * Use this at catch boundaries to ensure all errors are typed.
 */
export function wrapError(err: unknown, context?: Record<string, unknown>): ConcurrentError {
  if (err instanceof ConcurrentError) {
    return err;
  }

  if (err instanceof Error) {
    return new ConcurrentError("UNKNOWN_ERROR", err.message, {
      context: { ...context, originalName: err.name },
      cause: err,
    });
  }

  return new ConcurrentError("UNKNOWN_ERROR", String(err), { context });
}
