/**
 * CLI Interaction Channel
 *
 * Terminal channel for developer/local operator execution.
 */

import { createLogger } from "@concurrent/core";
import type {
  ApprovalRequest,
  ClarificationRequest,
  EscalationRequest,
  InteractionChannel,
} from "../types.js";

export type CLIInputHandler = (promptText: string) => Promise<string>;

export class CLIInteractionChannel implements InteractionChannel {
  readonly name = "cli";
  private log = createLogger({ component: "cli-channel" });
  private inputHandler?: CLIInputHandler;

  constructor(options?: { inputHandler?: CLIInputHandler }) {
    this.inputHandler = options?.inputHandler;
  }

  setInputHandler(handler: CLIInputHandler): void {
    this.inputHandler = handler;
  }

  async sendApprovalRequest(request: ApprovalRequest): Promise<void> {
    const divider = "═".repeat(60);
    console.log(`\n${divider}`);
    console.log(` ⚠️  HUMAN APPROVAL REQUIRED [Risk: ${request.riskLevel.toUpperCase()}]`);
    console.log(`${divider}`);
    console.log(` Task ID:     ${request.taskId}`);
    console.log(` Action:      ${request.actionName}`);
    console.log(` Reason:      ${request.reason}`);
    if (request.consequences) {
      console.log(` Impact:      ${request.consequences}`);
    }
    console.log(` Parameters:  ${JSON.stringify(request.parameters, null, 2)}`);
    if (request.timeoutMs) {
      console.log(` Timeout:     ${Math.round(request.timeoutMs / 1000)}s`);
    }
    console.log(`${divider}\n`);
    this.log.info({ requestId: request.id, action: request.actionName }, "Displayed approval request in CLI");
  }

  async sendClarificationRequest(request: ClarificationRequest): Promise<void> {
    const divider = "─".repeat(60);
    console.log(`\n${divider}`);
    console.log(` ❓ CLARIFICATION NEEDED`);
    console.log(`${divider}`);
    console.log(` Question:    ${request.question}`);
    if (request.contextDescription) {
      console.log(` Context:     ${request.contextDescription}`);
    }
    if (request.options && request.options.length > 0) {
      console.log(` Options:`);
      request.options.forEach((opt, idx) => {
        console.log(`   [${idx + 1}] ${opt.label} (${opt.value})`);
      });
    }
    if (request.defaultValue) {
      console.log(` Default:     ${request.defaultValue}`);
    }
    console.log(`${divider}\n`);
    this.log.info({ requestId: request.id }, "Displayed clarification request in CLI");
  }

  async sendEscalationAlert(request: EscalationRequest): Promise<void> {
    const divider = "!".repeat(60);
    console.log(`\n${divider}`);
    console.log(` 🚨 TASK ESCALATION ALERT [Trigger: ${request.trigger}]`);
    console.log(`${divider}`);
    console.log(` Task ID:     ${request.taskId}`);
    console.log(` Summary:     ${request.summary}`);
    console.log(` Assigned To: ${request.assignedTo.name || request.assignedTo.role || "Operator"}`);
    if (request.assignedTo.email) {
      console.log(` Email:       ${request.assignedTo.email}`);
    }
    if (request.attemptedSteps && request.attemptedSteps.length > 0) {
      console.log(` Execution History:`);
      request.attemptedSteps.forEach((s) => {
        console.log(`   * Step ${s.stepId} (${s.action}): ${s.status} ${s.error ? `-> ${s.error}` : ""}`);
      });
    }
    if (request.suggestedActions.length > 0) {
      console.log(` Suggested Next Steps:`);
      request.suggestedActions.forEach((a, i) => console.log(`   ${i + 1}. ${a}`));
    }
    console.log(`${divider}\n`);
    this.log.warn({ requestId: request.id, trigger: request.trigger }, "Displayed escalation alert in CLI");
  }

  /** Read input from configured handler */
  async promptUser(promptText: string): Promise<string> {
    if (this.inputHandler) {
      return await this.inputHandler(promptText);
    }
    return "";
  }
}
