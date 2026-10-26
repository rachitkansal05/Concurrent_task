import { describe, it, expect } from "vitest";
import { formatPlanForCLI } from "../src/display/formatter.js";
import { createTask } from "@concurrent/core";
import type { Plan } from "@concurrent/core";

describe("Plan Formatter", () => {
  it("should render clean terminal formatting for a plan", () => {
    const task = createTask({
      request: "Generate Q3 report and email finance",
      riskLevel: "medium",
    });
    task.expandedRequest = "Navigate to portal, generate PDF, email finance team";

    const plan: Plan = {
      taskId: task.id,
      status: "draft",
      revision: 1,
      createdAt: new Date(),
      steps: [
        {
          id: 1,
          action: "browser.navigate",
          params: { url: "https://expenses.internal.com" },
          dependsOn: [],
          description: "Load portal",
          expected: "Portal displayed",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
        {
          id: 2,
          action: "email.send",
          params: { to: "finance@company.com", subject: "Q3 Report" },
          dependsOn: [1],
          description: "Send email",
          expected: "Delivered",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 3,
        },
      ],
    };

    const rendered = formatPlanForCLI(plan, task);

    expect(rendered).toContain("EXECUTION PLAN");
    expect(rendered).toContain("RISK: MEDIUM");
    expect(rendered).toContain("Step 1: browser.navigate");
    expect(rendered).toContain("Step 2: email.send [Depends on: 1]");
    expect(rendered).toContain("Dependency Flow:");
    expect(rendered).toContain("(1: browser.navigate) ──► (2: email.send)");
  });
});
