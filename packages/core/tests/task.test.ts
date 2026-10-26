import { describe, it, expect } from "vitest";
import { createTask, generateId } from "../src/factories.js";

describe("Task Factory & Domain Types", () => {
  it("should create a task with expected defaults", () => {
    const task = createTask({
      request: "Download Q3 expense report and email to finance",
      requestedBy: "alice@company.com",
    });

    expect(task.id).toBeDefined();
    expect(task.id.length).toBeGreaterThan(0);
    expect(task.request).toBe("Download Q3 expense report and email to finance");
    expect(task.requestedBy).toBe("alice@company.com");
    expect(task.status).toBe("pending");
    expect(task.riskLevel).toBe("medium");
    expect(task.type).toBe("unknown");
    expect(task.evidence).toEqual([]);
    expect(task.createdAt).toBeInstanceOf(Date);
  });

  it("should allow overriding task type and risk level", () => {
    const task = createTask({
      request: "Transfer $1,000,000 to vendor",
      type: "approval_workflow",
      riskLevel: "critical",
    });

    expect(task.type).toBe("approval_workflow");
    expect(task.riskLevel).toBe("critical");
  });

  it("should generate distinct random IDs", () => {
    const id1 = generateId();
    const id2 = generateId();
    expect(id1).not.toBe(id2);
  });
});
