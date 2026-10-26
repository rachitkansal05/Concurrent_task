/**
 * Interaction Channel Manager
 *
 * Coordinates broadcasting and receiving from multiple communication channels
 * (CLI, Web Dashboard, Slack/Teams).
 */

import { createLogger } from "@concurrent/core";
import type {
  ApprovalRequest,
  ClarificationRequest,
  EscalationRequest,
  InteractionChannel,
} from "../types.js";

export class ChannelManager {
  private log = createLogger({ component: "channel-manager" });
  private channels: Map<string, InteractionChannel> = new Map();

  /** Register an interaction channel */
  registerChannel(channel: InteractionChannel): void {
    this.channels.set(channel.name, channel);
    this.log.info({ channel: channel.name }, "Interaction channel registered");
  }

  /** Get a channel by name */
  getChannel(name: string): InteractionChannel | undefined {
    return this.channels.get(name);
  }

  /** List all registered channels */
  listChannels(): string[] {
    return Array.from(this.channels.keys());
  }

  /** Broadcast an approval request to all registered channels */
  async broadcastApproval(request: ApprovalRequest): Promise<void> {
    this.log.debug({ requestId: request.id, channels: this.listChannels() }, "Broadcasting approval request");
    for (const channel of this.channels.values()) {
      try {
        await channel.sendApprovalRequest(request);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error({ channel: channel.name, err: msg }, "Failed to send approval to channel");
      }
    }
  }

  /** Broadcast a clarification request to all registered channels */
  async broadcastClarification(request: ClarificationRequest): Promise<void> {
    this.log.debug({ requestId: request.id }, "Broadcasting clarification request");
    for (const channel of this.channels.values()) {
      try {
        await channel.sendClarificationRequest(request);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error({ channel: channel.name, err: msg }, "Failed to send clarification to channel");
      }
    }
  }

  /** Broadcast an escalation alert to all registered channels */
  async broadcastEscalation(request: EscalationRequest): Promise<void> {
    this.log.warn({ requestId: request.id, trigger: request.trigger }, "Broadcasting escalation alert");
    for (const channel of this.channels.values()) {
      try {
        await channel.sendEscalationAlert(request);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.log.error({ channel: channel.name, err: msg }, "Failed to send escalation to channel");
      }
    }
  }
}
