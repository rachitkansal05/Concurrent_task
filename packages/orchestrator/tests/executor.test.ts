import { describe, it, expect, beforeEach } from "vitest";
import { PlanExecutor } from "../src/executor.js";
import { ToolRegistryImpl, createTask } from "@concurrent/core";
import { registerAllTools } from "@concurrent/tools";
import type { Plan } from "@concurrent/core";

describe("Plan Executor", () => {
  let registry: ToolRegistryImpl;
  let executor: PlanExecutor;

  beforeEach(() => {
    registry = new ToolRegistryImpl();
    registerAllTools(registry);
    executor = new PlanExecutor(registry);
  });

  it("should execute a multi-step plan in dryRun mode with data piping", async () => {
    const task = createTask({
      request: "Read a template and write output",
      requestedBy: "orchestrator-test",
    });

    const plan: Plan = {
      taskId: task.id,
      status: "draft",
      revision: 1,
      createdAt: new Date(),
      steps: [
        {
          id: 1,
          action: "file.write",
          params: { path: "./tmp/sample.txt", content: "PlanExecutor Verified" },
          dependsOn: [],
          description: "Write sample file",
          expected: "File written",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
        {
          id: 2,
          action: "email.send",
          params: {
            to: "team@company.com",
            subject: "Execution Complete",
            body: "Report generated at {{step_1.output.path}}",
            attachments: ["{{step_1.output.path}}"],
          },
          dependsOn: [1],
          description: "Send confirmation email",
          expected: "Email dispatched",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    };

    const report = await executor.executePlan(task, plan, { dryRun: true });

    expect(report.success).toBe(true);
    expect(report.stepsCompleted).toBe(2);
    expect(plan.status).toBe("completed");
    expect(plan.steps[0].status).toBe("success");
    expect(plan.steps[1].status).toBe("success");
    expect(report.evidence.length).toBeGreaterThanOrEqual(1);
  });

  it("should retry transient failures up to maxRetries", async () => {
    let callCount = 0;
    registry.register({
      name: "flaky.tool",
      description: "A tool that fails initially then succeeds",
      category: "custom",
      riskLevel: "low",
      parameters: { type: "object", properties: {} },
      validate: () => ({ valid: true, errors: [] }),
      execute: async () => {
        callCount++;
        if (callCount < 2) {
          return {
            success: false,
            output: {},
            evidence: [],
            error: "Temporary network timeout",
            durationMs: 1,
          };
        }
        return {
          success: true,
          output: { recovered: true },
          evidence: [],
          durationMs: 1,
        };
      },
    });

    const task = createTask({ request: "Flaky test", requestedBy: "tester" });
    const plan: Plan = {
      taskId: task.id,
      status: "draft",
      revision: 1,
      createdAt: new Date(),
      steps: [
        {
          id: 1,
          action: "flaky.tool",
          params: {},
          dependsOn: [],
          description: "Call flaky tool",
          expected: "Success after retry",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    };

    const report = await executor.executePlan(task, plan);
    expect(report.success).toBe(true);
    expect(callCount).toBe(2);
    expect(plan.steps[0].status).toBe("success");
  });
});

