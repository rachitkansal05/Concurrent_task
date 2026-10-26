import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig } from "../src/config/index.js";
import { resolve } from "node:path";

describe("Config Loader", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should load default configuration correctly", () => {
    const configPath = resolve(__dirname, "../../../config");
    const config = loadConfig({ configDir: configPath, env: "test-nonexistent" });

    expect(config.app.name).toBe("concurrent");
    expect(config.execution.maxConcurrentTasks).toBe(3);
    expect(config.approval.requireApprovalFor).toContain("high");
    expect(config.approval.requireApprovalFor).toContain("critical");
  });

  it("should merge environment overrides when available", () => {
    const configPath = resolve(__dirname, "../../../config");
    const config = loadConfig({ configDir: configPath, env: "development" });

    // In development.yaml, dryRun is true and logLevel is debug
    expect(config.execution.dryRun).toBe(true);
    expect(config.app.logLevel).toBe("debug");
  });

  it("should respect environment variable overrides", () => {
    process.env.CONCURRENT_LOG_LEVEL = "warn";
    process.env.CONCURRENT_LLM_PROVIDER = "anthropic";
    process.env.CONCURRENT_LLM_MODEL = "claude-3-5-sonnet";

    const config = loadConfig({ configDir: resolve(__dirname, "../../../config") });

    expect(config.app.logLevel).toBe("warn");
    expect(config.llm.provider).toBe("anthropic");
    expect(config.llm.model).toBe("claude-3-5-sonnet");
  });
});
