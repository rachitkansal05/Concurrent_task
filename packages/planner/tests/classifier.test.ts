import { describe, it, expect } from "vitest";
import { TaskClassifier } from "../src/classifier/index.js";
import { MockLLMClient } from "../src/llm/index.js";

describe("Task Classifier & Context Expansion", () => {
  it("should classify using rule-based heuristics offline", () => {
    const mock = new MockLLMClient();
    const classifier = new TaskClassifier(mock);

    const result = classifier.classifyHeuristic("Please delete production database");
    expect(result.riskLevel).toBe("critical");

    const emailResult = classifier.classifyHeuristic("Send weekly update email to the engineering team");
    expect(emailResult.taskType).toBe("communication");
    expect(emailResult.riskLevel).toBe("medium");

    const readResult = classifier.classifyHeuristic("Search internal wiki for vacation policy");
    expect(readResult.riskLevel).toBe("low");
  });

  it("should parse structured LLM classification when available", async () => {
    const mock = new MockLLMClient();
    mock.queueResponse(
      JSON.stringify({
        expandedRequest: "Navigate to expense portal, export Q3 ledger, and send to finance@company.com",
        taskType: "composite",
        riskLevel: "medium",
        reasoning: "Task combines report generation with internal email delivery",
        inferredEntities: {
          systems: ["expense portal"],
          departments: ["finance"],
        },
      }),
    );

    const classifier = new TaskClassifier(mock);
    const result = await classifier.classify("Send Q3 expense report to finance");

    expect(result.taskType).toBe("composite");
    expect(result.riskLevel).toBe("medium");
    expect(result.expandedRequest).toContain("Navigate to expense portal");
    expect(result.inferredEntities.departments).toContain("finance");
  });
});
