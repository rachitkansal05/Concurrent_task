/**
 * @concurrent/core — Main entry point
 *
 * Re-exports all types, config, logging, errors, and utilities.
 */

// Types
export type {
  Task,
  TaskStatus,
  TaskType,
  RiskLevel,
  Plan,
  PlanStatus,
  Step,
  StepStatus,
  Evidence,
  EvidenceType,
  Observation,
  Tool,
  ToolResult,
  ToolRegistry,
  ToolCatalogEntry,
  ExecutionContext,
  ValidationResult,
  JSONSchema,
  JSONSchemaProperty,
  AppConfig,
} from "./types/index.js";

// Config
export { loadConfig } from "./config/index.js";
export type { ConfigLoaderOptions } from "./config/index.js";

// Logging
export { initLogger, createLogger, getRootLogger } from "./logging/index.js";
export type { LoggerOptions } from "./logging/index.js";

// Errors
export {
  ConcurrentError,
  PlanError,
  ToolError,
  ConfigError,
  AuthError,
  wrapError,
} from "./errors/index.js";
export type { ErrorCode } from "./errors/index.js";

// Registry
export { ToolRegistryImpl } from "./registry.js";

// Factories
export { createTask, generateId } from "./factories.js";
export type { CreateTaskOptions } from "./factories.js";
