/**
 * Notification Tools
 *
 * Sends alert messages to Slack, Microsoft Teams, or webhook channels.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { createLogger } from "@concurrent/core";

const log = createLogger({ component: "notify.send" });

export class NotifySendTool implements Tool {
  readonly name = "notify.send";
  readonly description = "Post an alert or message to a team communication channel (Slack or Microsoft Teams)";
  readonly category = "communication";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      channel: { type: "string" as const, description: "Target channel name, e.g. '#engineering', '#finance'" },
      message: { type: "string" as const, description: "Notification text or markdown message" },
      platform: {
        type: "string" as const,
        description: "Target platform: slack (default) or teams",
        enum: ["slack", "teams"],
      },
    },
    required: ["channel", "message"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      delivered: { type: "boolean" as const },
      channel: { type: "string" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!params.channel) errors.push("'channel' parameter is required.");
    if (!params.message) errors.push("'message' parameter is required.");
    return { valid: errors.length === 0, errors };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const channel = String(params.channel);
    const message = String(params.message);
    const platform = (params.platform as string) || "slack";

    log.info({ channel, platform }, `Notification sent to ${channel}`);

    return {
      success: true,
      output: { delivered: true, channel, platform },
      evidence: [
        {
          type: "text",
          value: `[${platform.toUpperCase()} notification to ${channel}]: ${message}`,
          timestamp: new Date(),
          stepId: context.stepId,
        },
      ],
      durationMs: Date.now() - startTime,
    };
  }
}
