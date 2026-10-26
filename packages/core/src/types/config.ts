/**
 * Configuration types for Concurrent.
 *
 * Configuration is loaded from:
 * 1. config/default.yaml (base config)
 * 2. config/{environment}.yaml (environment override)
 * 3. .env file (secrets and environment variables)
 * 4. Process environment variables (highest priority)
 */

import type { RiskLevel } from "./task.js";

export interface AppConfig {
  /** Application settings */
  app: {
    name: string;
    version: string;
    environment: "development" | "staging" | "production";
    logLevel: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  };

  /** LLM provider configuration */
  llm: {
    /** Which provider to use: "openai" | "anthropic" | "ollama" */
    provider: string;
    /** Model name, e.g., "gpt-4o", "claude-sonnet-4-20250514", "llama3" */
    model: string;
    /** API base URL (for Ollama or custom endpoints) */
    baseUrl?: string;
    /** API key (loaded from env, never from YAML) */
    apiKey?: string;
    /** Max tokens for plan generation */
    maxTokens: number;
    /** Temperature for plan generation */
    temperature: number;
  };

  /** Execution settings */
  execution: {
    /** Max concurrent tasks */
    maxConcurrentTasks: number;
    /** Max retries per step */
    maxRetriesPerStep: number;
    /** Max retries per task (total across all steps) */
    maxRetriesPerTask: number;
    /** Step execution timeout (ms) */
    stepTimeoutMs: number;
    /** Whether to run in dry-run mode by default */
    dryRun: boolean;
  };

  /** Approval settings */
  approval: {
    /** Risk levels that require human approval before execution */
    requireApprovalFor: RiskLevel[];
    /** Timeout for approval requests (minutes) */
    approvalTimeoutMinutes: number;
    /** Whether to auto-approve low-risk tasks */
    autoApproveLowRisk: boolean;
  };

  /** Browser tool settings */
  browser: {
    /** Run in headless mode */
    headless: boolean;
    /** Default navigation timeout (ms) */
    navigationTimeoutMs: number;
    /** Allowed domains (empty = all allowed) */
    allowedDomains: string[];
    /** Whether to capture screenshots at every step */
    screenshotEveryStep: boolean;
  };

  /** File system settings */
  filesystem: {
    /** Allowed directories for file operations */
    allowedPaths: string[];
    /** Evidence storage directory */
    evidenceDir: string;
  };

  /** Context engine settings */
  context: {
    /** Path to procedure definitions directory */
    proceduresDir: string;
    /** Path to knowledge base directory */
    knowledgeDir: string;
    /** Vector store type */
    vectorStore: "chroma" | "lancedb" | "memory";
  };
}
