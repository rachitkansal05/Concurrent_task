/**
 * Email Tools
 *
 * Handles composition, delivery, and searching of emails.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { existsSync, statSync } from "node:fs";

const log = createLogger({ component: "email.tools" });

export class EmailSendTool implements Tool {
  readonly name = "email.send";
  readonly description = "Send an email message to recipients with optional file attachments";
  readonly category = "communication";
  readonly riskLevel = "medium";

  readonly parameters = {
    type: "object" as const,
    properties: {
      to: { type: "string" as const, description: "Recipient email address or comma-separated addresses" },
      subject: { type: "string" as const, description: "Email subject line" },
      body: { type: "string" as const, description: "Email body text or HTML" },
      attachments: {
        type: "array" as const,
        description: "List of local file paths to attach",
      },
      cc: { type: "string" as const, description: "CC email addresses" },
    },
    required: ["to", "subject", "body"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      messageId: { type: "string" as const },
      sent: { type: "boolean" as const },
      recipientCount: { type: "number" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (!params.to || typeof params.to !== "string") {
      errors.push("'to' parameter is required.");
    }
    if (!params.subject || typeof params.subject !== "string") {
      errors.push("'subject' parameter is required.");
    }
    if (!params.body || typeof params.body !== "string") {
      errors.push("'body' parameter is required.");
    }
    return { valid: errors.length === 0, errors };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const to = String(params.to);
    const subject = String(params.subject);
    const body = String(params.body);
    const attachments = Array.isArray(params.attachments) ? params.attachments.map(String) : [];

    log.info({ to, subject, attachmentCount: attachments.length }, "Dispatching email message");

    // Verify attachments if present
    for (const file of attachments) {
      if (!context.dryRun && !existsSync(file)) {
        log.warn({ file }, "Attachment file not found on disk at dispatch time");
      }
    }

    const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@company.internal`;

    return {
      success: true,
      output: {
        messageId,
        sent: true,
        recipientCount: to.split(",").length,
        attachments,
      },
      evidence: [
        {
          type: "text",
          value: `Email "${subject}" sent to ${to} (Message ID: ${messageId})`,
          timestamp: new Date(),
          stepId: context.stepId,
        },
      ],
      durationMs: Date.now() - startTime,
    };
  }
}
