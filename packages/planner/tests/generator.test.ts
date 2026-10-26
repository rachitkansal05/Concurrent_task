import { describe, it, expect, beforeEach } from "vitest";
import { PlanGenerator } from "../src/planner/generator.js";
import { MockLLMClient } from "../src/llm/index.js";
import { ToolRegistryImpl, createTask } from "@concurrent/core";
import { registerStarterTools } from "@concurrent/tools";

describe("Plan Generator", () => {
  let registry: ToolRegistryImpl;
  let mockLLM: MockLLMClient;

  beforeEach(() => {
    registry = new ToolRegistryImpl();
    registerStarterTools(registry);
    mockLLM = new MockLLMClient();
  });

  it("should generate and validate an execution plan using LLM output", async () => {
    mockLLM.queueResponse(
      JSON.stringify({
        reasoning: "Navigate to expense portal, generate report, download PDF, and email to finance",
        steps: [
          {
            id: 1,
            action: "browser.navigate",
            params: { url: "https://expenses.internal.com" },
            dependsOn: [],
            description: "Load expenses portal",
            expected: "Portal dashboard visible",
          },
          {
            id: 2,
            action: "browser.click",
            params: { selector: "#generate-report" },
            dependsOn: [1],
            description: "Click generate report button",
            expected: "Report begins generating",
          },
          {
            id: 3,
            action: "browser.download",
            params: { waitFor: ".download-ready" },
            dependsOn: [2],
            description: "Download the generated PDF report",
            expected: "PDF file saved locally",
          },
          {
            id: 4,
            action: "email.send",
            params: {
              to: "finance@company.com",
              subject: "Q3 Expense Report",
              attachments: ["{{step_3.output.filePath}}"],
            },
            dependsOn: [3],
            description: "Send email with attached report to finance",
            expected: "Email sent successfully",
          },
        ],
      }),
    );

    const task = createTask({
      request: "Generate the Q3 expense report and email it to finance",
      requestedBy: "test-user",
    });

    const generator = new PlanGenerator(mockLLM, registry);
    const plan = await generator.generatePlan(task);

    expect(plan.taskId).toBe(task.id);
    expect(plan.steps).toHaveLength(4);
    expect(plan.steps[0].action).toBe("browser.navigate");
    expect(plan.steps[3].action).toBe("email.send");
    expect(plan.steps[3].dependsOn).toEqual([3]);
    expect(plan.status).toBe("draft");
  });
});
