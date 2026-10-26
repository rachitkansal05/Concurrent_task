/**
 * Configuration Loader
 *
 * Loads configuration from multiple sources in priority order:
 * 1. config/default.yaml          — base defaults
 * 2. config/{environment}.yaml    — environment-specific overrides
 * 3. .env file                    — secrets (API keys, passwords)
 * 4. Process environment vars     — highest priority overrides
 *
 * Usage:
 *   const config = loadConfig();
 *   const config = loadConfig({ configDir: "./config", env: "production" });
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { config as loadDotenv } from "dotenv";
import type { AppConfig } from "../types/config.js";

/** Options for the config loader */
export interface ConfigLoaderOptions {
  /** Directory containing YAML config files. Default: "./config" */
  configDir?: string;
  /** Environment name. Default: process.env.NODE_ENV or "development" */
  env?: string;
  /** Path to .env file. Default: "./.env" */
  envFile?: string;
}

/** Default configuration values */
const DEFAULTS: AppConfig = {
  app: {
    name: "concurrent",
    version: "0.1.0",
    environment: "development",
    logLevel: "info",
  },
  llm: {
    provider: "openai",
    model: "gpt-4o",
    maxTokens: 4096,
    temperature: 0.2,
  },
  execution: {
    maxConcurrentTasks: 3,
    maxRetriesPerStep: 3,
    maxRetriesPerTask: 10,
    stepTimeoutMs: 60_000,
    dryRun: false,
  },
  approval: {
    requireApprovalFor: ["high", "critical"],
    approvalTimeoutMinutes: 30,
    autoApproveLowRisk: true,
  },
  browser: {
    headless: true,
    navigationTimeoutMs: 30_000,
    allowedDomains: [],
    screenshotEveryStep: true,
  },
  filesystem: {
    allowedPaths: [],
    evidenceDir: "./evidence",
  },
  context: {
    proceduresDir: "./config/procedures",
    knowledgeDir: "./knowledge",
    vectorStore: "memory",
  },
};

/**
 * Deep merge two objects. Source values override target values.
 * Arrays are replaced, not merged.
 */
function deepMerge<T>(target: T, source: Record<string, unknown>): T {
  const result: any = { ...target };

  for (const key of Object.keys(source)) {
    const sourceVal = source[key];
    const targetVal = result[key];

    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === "object" &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === "object" &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(targetVal, sourceVal as Record<string, unknown>);
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal;
    }
  }

  return result as T;
}

/**
 * Load a YAML file and return its contents as an object.
 * Returns empty object if the file doesn't exist.
 */
function loadYamlFile(filePath: string): Record<string, unknown> {
  const resolved = resolve(filePath);
  if (!existsSync(resolved)) {
    return {};
  }
  const content = readFileSync(resolved, "utf-8");
  return (parseYaml(content) as Record<string, unknown>) ?? {};
}

/**
 * Apply environment variable overrides.
 * Environment variables are mapped as:
 *   CONCURRENT_APP_LOG_LEVEL → app.logLevel
 *   CONCURRENT_LLM_API_KEY  → llm.apiKey
 *   CONCURRENT_LLM_PROVIDER → llm.provider
 */
function applyEnvOverrides(config: AppConfig): AppConfig {
  const env = process.env;

  // LLM overrides
  if (env.CONCURRENT_LLM_PROVIDER) config.llm.provider = env.CONCURRENT_LLM_PROVIDER;
  if (env.CONCURRENT_LLM_MODEL) config.llm.model = env.CONCURRENT_LLM_MODEL;
  if (env.CONCURRENT_LLM_BASE_URL) config.llm.baseUrl = env.CONCURRENT_LLM_BASE_URL;
  if (env.CONCURRENT_LLM_API_KEY) config.llm.apiKey = env.CONCURRENT_LLM_API_KEY;

  // Also accept standard API key env vars
  if (!config.llm.apiKey) {
    config.llm.apiKey =
      env.OPENAI_API_KEY ?? env.ANTHROPIC_API_KEY ?? env.LLM_API_KEY;
  }

  // App overrides
  if (env.CONCURRENT_LOG_LEVEL) {
    config.app.logLevel = env.CONCURRENT_LOG_LEVEL as AppConfig["app"]["logLevel"];
  }
  if (env.NODE_ENV) {
    config.app.environment = env.NODE_ENV as AppConfig["app"]["environment"];
  }

  // Execution overrides
  if (env.CONCURRENT_DRY_RUN) {
    config.execution.dryRun = env.CONCURRENT_DRY_RUN === "true";
  }

  return config;
}

/**
 * Load and merge configuration from all sources.
 */
export function loadConfig(options: ConfigLoaderOptions = {}): AppConfig {
  const configDir = options.configDir ?? "./config";
  const env = options.env ?? process.env.NODE_ENV ?? "development";
  const envFile = options.envFile ?? "./.env";

  // 1. Load .env file
  loadDotenv({ path: resolve(envFile) });

  // 2. Start with defaults
  let config: AppConfig = structuredClone(DEFAULTS);

  // 3. Merge base YAML config
  const baseYaml = loadYamlFile(join(configDir, "default.yaml"));
  config = deepMerge(config, baseYaml);

  // 4. Merge environment-specific YAML config
  const envYaml = loadYamlFile(join(configDir, `${env}.yaml`));
  config = deepMerge(config, envYaml);

  // 5. Apply environment variable overrides (highest priority)
  config = applyEnvOverrides(config);

  // Set the environment
  config.app.environment = env as AppConfig["app"]["environment"];

  return config;
}
