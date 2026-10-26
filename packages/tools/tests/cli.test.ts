import { describe, it, expect } from "vitest";
import { CliExecuteTool } from "../src/cli/index.js";

describe("CLI Tools", () => {
  const dummyContext = {
    taskId: "test-task",
    stepId: 1,
    workingDir: process.cwd(),
    previousOutputs: new Map(),
    allowedDomains: [],
    allowedPaths: [],
    dryRun: false,
  };

  it("should execute a shell command and capture stdout", async () => {
    const cliTool = new CliExecuteTool();
    const result = await cliTool.execute({ command: "node -e \"console.log('concurrent-cli-test')\"" }, dummyContext);

    expect(result.success).toBe(true);
    expect(result.output.exitCode).toBe(0);
    expect(result.output.stdout).toContain("concurrent-cli-test");
    expect(result.evidence).toHaveLength(1);
  });

  it("should capture nonzero exit codes and stderr", async () => {
    const cliTool = new CliExecuteTool();
    const result = await cliTool.execute({ command: "node -e \"process.exit(2)\"" }, dummyContext);

    expect(result.success).toBe(false);
    expect(result.output.exitCode).toBe(2);
  });
});
