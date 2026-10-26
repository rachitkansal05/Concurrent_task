/**
 * @concurrent/gateway
 *
 * Human-in-the-loop: Clarifications, Approvals, Escalation,
 * and Multi-Channel Communication (CLI, Web Dashboard, Slack/Teams).
 */

export const GATEWAY_MODULE_VERSION = "0.1.0";

// Domain Types
export * from "./types.js";

// Channels
export { ChannelManager } from "./channels/channel.js";
export { CLIInteractionChannel, type CLIInputHandler } from "./channels/cli.js";
export {
  WebDashboardChannel,
  type WebDashboardOptions,
  type ApprovalDecisionCallback,
  type ClarificationAnswerCallback,
} from "./channels/web.js";
export {
  ChatIntegrationChannel,
  type ChatChannelOptions,
  type ChatMessagePayload,
} from "./channels/chat.js";

// Workflows & Engines
export {
  ClarificationEngine,
  type AskClarificationParams,
} from "./clarification/clarification.js";
export {
  ApprovalWorkflow,
  type RequestApprovalParams,
  type ApprovalOutcome,
} from "./approval/approval.js";
export {
  EscalationEngine,
  type CreateEscalationParams,
  type HumanCorrectionRecord,
} from "./escalation/escalation.js";

// Unified Gateway Facade
export {
  HumanGateway,
  type HumanGatewayOptions,
} from "./gateway.js";
