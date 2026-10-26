/**
 * Unified Human Gateway
 *
 * Single entry point coordinating Clarifications, Approvals, Escalations,
 * and Multi-channel dispatch (CLI, Web Dashboard, Slack/Teams).
 */

import { createLogger } from "@concurrent/core";
import { ChannelManager } from "./channels/channel.js";
import { CLIInteractionChannel, CLIInputHandler } from "./channels/cli.js";
import { WebDashboardChannel, WebDashboardOptions } from "./channels/web.js";
import { ChatIntegrationChannel, ChatChannelOptions } from "./channels/chat.js";
import { ClarificationEngine, AskClarificationParams } from "./clarification/clarification.js";
import { ApprovalWorkflow, RequestApprovalParams, ApprovalOutcome } from "./approval/approval.js";
import { EscalationEngine, CreateEscalationParams } from "./escalation/escalation.js";
import type { EscalationRequest } from "./types.js";

export interface HumanGatewayOptions {
  cli?: boolean | { inputHandler?: CLIInputHandler };
  web?: boolean | WebDashboardOptions;
  chat?: ChatChannelOptions;
}

export class HumanGateway {
  private log = createLogger({ component: "human-gateway" });
  readonly channels: ChannelManager;
  readonly clarifications: ClarificationEngine;
  readonly approvals: ApprovalWorkflow;
  readonly escalations: EscalationEngine;

  readonly cliChannel?: CLIInteractionChannel;
  readonly webChannel?: WebDashboardChannel;
  readonly chatChannel?: ChatIntegrationChannel;

  constructor(options: HumanGatewayOptions = { cli: true }) {
    this.channels = new ChannelManager();

    // 1. CLI Channel (default true)
    if (options.cli) {
      const cliOptions = typeof options.cli === "object" ? options.cli : undefined;
      this.cliChannel = new CLIInteractionChannel(cliOptions);
      this.channels.registerChannel(this.cliChannel);
    }

    // 2. Web Dashboard Channel
    if (options.web) {
      const webOptions = typeof options.web === "object" ? options.web : {};
      this.webChannel = new WebDashboardChannel(webOptions);
      this.channels.registerChannel(this.webChannel);

      // Connect web dashboard actions to engines
      this.webChannel.setCallbacks({
        onApprovalDecision: async (id, decision, params) => {
          return this.approvals.decide(id, decision, {
            modifiedParameters: params?.modifiedParameters,
            feedbackNote: params?.note,
            decidedBy: params?.decidedBy,
          });
        },
        onClarificationAnswer: async (id, answer, answeredBy) => {
          return this.clarifications.answer(id, answer, answeredBy);
        },
      });
    }

    // 3. Chat Integration Channel (Slack/Teams)
    if (options.chat) {
      this.chatChannel = new ChatIntegrationChannel(options.chat);
      this.channels.registerChannel(this.chatChannel);
    }

    // Instantiate core workflow engines
    this.clarifications = new ClarificationEngine(this.channels);
    this.approvals = new ApprovalWorkflow(this.channels);
    this.escalations = new EscalationEngine(this.channels);

    this.log.info({ channels: this.channels.listChannels() }, "HumanGateway initialized");
  }

  /** Request approval for a high-risk action */
  async requestApproval(params: RequestApprovalParams): Promise<ApprovalOutcome> {
    return this.approvals.requestApproval(params);
  }

  /** Ask a human clarification question */
  async askClarification(params: AskClarificationParams): Promise<string> {
    return this.clarifications.ask(params);
  }

  /** Escalate a task incident to human operators */
  async escalate(params: CreateEscalationParams): Promise<EscalationRequest> {
    return this.escalations.escalate(params);
  }

  /** Start web dashboard if configured */
  async startDashboard(): Promise<number | undefined> {
    if (this.webChannel) {
      return await this.webChannel.start();
    }
    return undefined;
  }

  /** Stop web dashboard if running */
  async stopDashboard(): Promise<void> {
    if (this.webChannel) {
      await this.webChannel.stop();
    }
  }
}
