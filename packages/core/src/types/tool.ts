/**
 * Tool — Something the agent can invoke to interact with the world.
 *
 * Tools are the bridge between the AI planner and real-world actions.
 * Every tool is registered in the ToolRegistry and can be discovered
 * by the planner via the tool catalog.
 */

import type { Evidence, RiskLevel } from "./task.js";

/**
 * JSON Schema type for describing tool parameters and return types.
 * This is a simplified representation — enough for LLM prompts and validation.
 */
export interface JSONSchemaProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  items?: JSONSchemaProperty;
  properties?: Record<string, JSONSchemaProperty>;
}

export interface JSONSchema {
  type: "object";
  properties: Record<string, JSONSchemaProperty>;
  required?: string[];
}

/**
 * Context passed to a tool during execution.
 * Contains runtime information the tool may need.
 */
export interface ExecutionContext {
  /** The task ID this execution belongs to */
  taskId: string;

  /** The step ID being executed */
  stepId: number;

  /** Working directory for file operations */
  workingDir: string;

  /** Outputs from previous steps (keyed by step ID) */
  previousOutputs: Map<number, Record<string, unknown>>;

  /** Allowed domains for browser tools (empty = all allowed) */
  allowedDomains: string[];

  /** Allowed directories for file tools (empty = all allowed) */
  allowedPaths: string[];

  /** Whether this is a dry-run (simulate but don't execute) */
  dryRun: boolean;

  /** Abort signal for cancellation */
  signal?: AbortSignal;
}

/**
 * Result returned by a tool after execution.
 */
export interface ToolResult {
  /** Whether the tool call succeeded */
  success: boolean;

  /** Structured output data */
  output: Record<string, unknown>;

  /** Evidence collected during execution */
  evidence: Evidence[];

  /** Error message if the call failed */
  error?: string;

  /** How long the execution took (ms) */
  durationMs: number;
}

/**
 * Result of validating tool parameters before execution.
 */
export interface ValidationResult {
  /** Whether the parameters are valid */
  valid: boolean;

  /** Validation error messages (empty if valid) */
  errors: string[];
}

/**
 * Tool interface — every tool in the system implements this.
 */
export interface Tool {
  /** Unique tool name, e.g., "browser.navigate", "email.send" */
  name: string;

  /** Human-readable description (used by LLM to understand when to use it) */
  description: string;

  /** Category for grouping, e.g., "browser", "filesystem", "email" */
  category: string;

  /** Input parameter schema */
  parameters: JSONSchema;

  /** Output schema */
  returns: JSONSchema;

  /** Risk level — determines whether approval is needed */
  riskLevel: RiskLevel;

  /** Validate parameters before execution */
  validate(params: Record<string, unknown>): ValidationResult;

  /** Execute the tool action */
  execute(
    params: Record<string, unknown>,
    context: ExecutionContext,
  ): Promise<ToolResult>;
}

/**
 * Tool catalog entry — a serializable description of a tool
 * that can be included in LLM prompts.
 */
export interface ToolCatalogEntry {
  name: string;
  description: string;
  category: string;
  parameters: JSONSchema;
  returns: JSONSchema;
  riskLevel: RiskLevel;
}

/**
 * ToolRegistry — manages all available tools.
 */
export interface ToolRegistry {
  /** Register a tool */
  register(tool: Tool): void;

  /** Get a tool by name */
  get(name: string): Tool | undefined;

  /** Check if a tool exists */
  has(name: string): boolean;

  /** Get all registered tool names */
  list(): string[];

  /** Get catalog entries for all tools (for LLM prompts) */
  catalog(): ToolCatalogEntry[];

  /** Get tools by category */
  byCategory(category: string): Tool[];
}
