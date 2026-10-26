/**
 * Structured Logging for Concurrent
 *
 * Uses Pino for fast, structured JSON logging.
 * Every log entry includes:
 *   - timestamp
 *   - level
 *   - traceId (for correlating logs across a single task execution)
 *   - component (which system component produced the log)
 *   - message
 *
 * Usage:
 *   const log = createLogger({ component: "planner" });
 *   log.info({ taskId: "abc" }, "Plan generated");
 *
 *   // With trace ID for task-scoped logging:
 *   const taskLog = log.child({ traceId: task.id });
 *   taskLog.info("Starting execution");
 */

import pino from "pino";
import type { AppConfig } from "../types/config.js";

export interface LoggerOptions {
  /** Component name for log context, e.g., "planner", "browser-tool", "orchestrator" */
  component: string;
  /** Log level override (defaults to config value) */
  level?: string;
}

/** The shared root logger instance */
let rootLogger: pino.Logger | null = null;

/**
 * Initialize the root logger. Call once at startup.
 */
export function initLogger(config: AppConfig): pino.Logger {
  rootLogger = pino({
    name: config.app.name,
    level: config.app.logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
    // Pretty print in development, JSON in production
    transport:
      config.app.environment === "development"
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss.l",
              ignore: "pid,hostname",
            },
          }
        : undefined,
  });

  return rootLogger;
}

/**
 * Create a child logger for a specific component.
 * The component name is attached to every log entry.
 */
export function createLogger(options: LoggerOptions): pino.Logger {
  if (!rootLogger) {
    // If initLogger hasn't been called yet, create a basic one
    rootLogger = pino({
      level: options.level ?? "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }

  const child = rootLogger.child({ component: options.component });

  if (options.level) {
    child.level = options.level;
  }

  return child;
}

/**
 * Get the root logger instance.
 */
export function getRootLogger(): pino.Logger {
  if (!rootLogger) {
    rootLogger = pino({
      level: "info",
      timestamp: pino.stdTimeFunctions.isoTime,
    });
  }
  return rootLogger;
}
