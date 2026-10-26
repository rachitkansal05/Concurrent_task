import { describe, it, expect } from "vitest";
import { EmailSendTool, NotifySendTool } from "../src/communication/index.js";

describe("Communication Tools", () => {
  const dummyContext = {
    taskId: "test-task",
    stepId: 1,
    workingDir: "./tmp",
    previousOutputs: new Map(),
    allowedDomains: [],
    allowedPaths: [],
    dryRun: false,
  };

  it("should validate and dispatch email", async () => {
    const emailTool = new EmailSendTool();
    const validation = emailTool.validate({ to: "test@company.com", subject: "Hello", body: "World" });
    expect(validation.valid).toBe(true);

    const result = await emailTool.execute(
      { to: "test@company.com", subject: "Q3 Report", body: "Please find report" },
      dummyContext,
    );

    expect(result.success).toBe(true);
    expect(result.output.sent).toBe(true);
    expect(result.output.messageId).toContain("@company.internal");
    expect(result.evidence).toHaveLength(1);
  });

  it("should send channel notification", async () => {
    const notifyTool = new NotifySendTool();
    const result = await notifyTool.execute(
      { channel: "#ops-alerts", message: "Task completed successfully" },
      dummyContext,
    );

    expect(result.success).toBe(true);
    expect(result.output.delivered).toBe(true);
    expect(result.output.channel).toBe("#ops-alerts");
  });
});
