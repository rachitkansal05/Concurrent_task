import { describe, it, expect, beforeEach } from "vitest";
import { PlanValidator } from "../src/planner/validator.js";
import { ToolRegistryImpl } from "@concurrent/core";
import { registerStarterTools } from "@concurrent/tools";
import type { Plan } from "@concurrent/core";

describe("Plan Validator", () => {
  let registry: ToolRegistryImpl;
  let validator: PlanValidator;

  beforeEach(() => {
    registry = new ToolRegistryImpl();
    registerStarterTools(registry);
    validator = new PlanValidator(registry);
  });

  it("should approve a valid sequential plan", () => {
    const plan: Plan = {
      taskId: "task-1",
      status: "draft",
      revision: 1,
      createdAt: new Date(),
      steps: [
        {
          id: 1,
          action: "browser.navigate",
          params: { url: "https://expenses.internal.com" },
          dependsOn: [],
          description: "Navigate to portal",
          expected: "Portal loaded",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
        {
          id: 2,
          action: "email.send",
          params: { to: "finance@company.com", subject: "Report" },
          dependsOn: [1],
          description: "Send email",
          expected: "Email sent",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    };

    const result = validator.validate(plan);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should fail validation on unregistered tool", () => {
    const plan: Plan = {
      taskId: "task-2",
      status: "draft",
      revision: 1,
      createdAt: new Date(),
      steps: [
        {
          id: 1,
          action: "unregistered.fake_tool",
          params: {},
          dependsOn: [],
          description: "Fake tool step",
          expected: "Should fail",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    };

    const result = validator.validate(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("unregistered tool"))).toBe(true);
  });

  it("should detect dependency cycles", () => {
    const plan: Plan = {
      taskId: "task-3",
      status: "draft",
      revision: 1,
      createdAt: new Date(),
      steps: [
        {
          id: 1,
          action: "browser.navigate",
          params: { url: "https://example.com" },
          dependsOn: [2], // Step 1 depends on Step 2
          description: "Step 1",
          expected: "Loaded",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
        {
          id: 2,
          action: "browser.navigate",
          params: { url: "https://example.com" },
          dependsOn: [1], // Step 2 depends on Step 1 (Cycle!)
          description: "Step 2",
          expected: "Loaded",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    };

    const result = validator.validate(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Dependency cycle"))).toBe(true);
  });

  it("should detect self dependencies", () => {
    const plan: Plan = {
      taskId: "task-4",
      status: "draft",
      revision: 1,
      createdAt: new Date(),
      steps: [
        {
          id: 1,
          action: "browser.navigate",
          params: { url: "https://example.com" },
          dependsOn: [1], // Self dependency
          description: "Step 1",
          expected: "Loaded",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    };

    const result = validator.validate(plan);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("depends on itself"))).toBe(true);
  });
});
