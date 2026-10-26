/**
 * Chat Integration Channel
 *
 * Slack and Microsoft Teams webhook integration for approvals,
 * clarifications, and escalation alerts.
 */

import { createLogger } from "@concurrent/core";
import type {
  ApprovalRequest,
  ClarificationRequest,
  EscalationRequest,
  InteractionChannel,
} from "../types.js";

export interface ChatChannelOptions {
  platform?: "slack" | "teams" | "generic";
  webhookUrl?: string;
  channelName?: string;
}

export interface ChatMessagePayload {
  platform: "slack" | "teams" | "generic";
  text: string;
  blocks?: unknown[];
  cards?: unknown[];
  timestamp: string;
}

export class ChatIntegrationChannel implements InteractionChannel {
  readonly name: string;
  private log = createLogger({ component: "chat-channel" });
  private platform: "slack" | "teams" | "generic";
  private webhookUrl?: string;
  private sentMessages: ChatMessagePayload[] = [];

  constructor(options: ChatChannelOptions = {}) {
    this.platform = options.platform ?? "slack";
    this.name = `chat-${this.platform}`;
    this.webhookUrl = options.webhookUrl;
  }

  getSentMessages(): ChatMessagePayload[] {
    return [...this.sentMessages];
  }

  async sendApprovalRequest(request: ApprovalRequest): Promise<void> {
    const text = `🚨 *Approval Required* [Risk: ${request.riskLevel.toUpperCase()}]\nTask \`${request.taskId}\` requires permission to execute *${request.actionName}*.\nReason: ${request.reason}`;

    const payload: ChatMessagePayload = {
      platform: this.platform,
      text,
      timestamp: new Date().toISOString(),
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Approve" },
              style: "primary",
              action_id: `approve_${request.id}`,
            },
            {
              type: "button",
              text: { type: "plain_text", text: "Reject" },
              style: "danger",
              action_id: `reject_${request.id}`,
            },
          ],
        },
      ],
    };

    await this.dispatch(payload);
  }

  async sendClarificationRequest(request: ClarificationRequest): Promise<void> {
    const text = `❓ *Clarification Needed* for Task \`${request.taskId}\`\n${request.question}`;
    const payload: ChatMessagePayload = {
      platform: this.platform,
      text,
      timestamp: new Date().toISOString(),
    };
    await this.dispatch(payload);
  }

  async sendEscalationAlert(request: EscalationRequest): Promise<void> {
    const text = `⚠️ *TASK ESCALATION ALERT* [Trigger: ${request.trigger}]\nTask: \`${request.taskId}\`\nAssigned To: ${request.assignedTo.name || request.assignedTo.role || "Operator"}\nSummary: ${request.summary}`;
    const payload: ChatMessagePayload = {
      platform: this.platform,
      text,
      timestamp: new Date().toISOString(),
    };
    await this.dispatch(payload);
  }

  private async dispatch(payload: ChatMessagePayload): Promise<void> {
    this.sentMessages.push(payload);
    this.log.info({ platform: this.platform, text: payload.text.slice(0, 80) }, "Dispatched message to chat channel");

    if (this.webhookUrl) {
      try {
        await fetch(this.webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.warn({ webhookUrl: this.webhookUrl, err: msg }, "Failed to send chat webhook request (continuing)");
      }
    }
  }
}
