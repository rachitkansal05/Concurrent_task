/**
 * Clarification Protocol Engine
 *
 * Asks specific questions when tasks are ambiguous or missing parameters,
 * supports multiple choice options and free text, and enforces timeouts.
 */

import { createLogger, generateId } from "@concurrent/core";
import type { ClarificationOption, ClarificationRequest } from "../types.js";
import type { ChannelManager } from "../channels/channel.js";

export interface AskClarificationParams {
  taskId: string;
  question: string;
  contextDescription?: string;
  options?: ClarificationOption[];
  allowFreeText?: boolean;
  defaultValue?: string;
  timeoutMs?: number;
}

export class ClarificationEngine {
  private log = createLogger({ component: "clarification-engine" });
  private pendingRequests: Map<
    string,
    {
      request: ClarificationRequest;
      resolve: (answer: string) => void;
      timer?: NodeJS.Timeout;
    }
  > = new Map();
  private history: ClarificationRequest[] = [];

  constructor(private channelManager?: ChannelManager) {}

  /** Ask a clarification question and wait for the response */
  async ask(params: AskClarificationParams): Promise<string> {
    const id = generateId();
    const request: ClarificationRequest = {
      id,
      taskId: params.taskId,
      question: params.question,
      contextDescription: params.contextDescription,
      options: params.options,
      allowFreeText: params.allowFreeText ?? true,
      defaultValue: params.defaultValue,
      timeoutMs: params.timeoutMs,
      createdAt: new Date().toISOString(),
      status: "pending",
    };

    this.log.info({ requestId: id, taskId: params.taskId, question: params.question }, "Asking clarification question");

    return new Promise((resolve) => {
      let timer: NodeJS.Timeout | undefined;

      if (params.timeoutMs && params.timeoutMs > 0) {
        timer = setTimeout(() => {
          this.handleTimeout(id);
        }, params.timeoutMs);
      }

      this.pendingRequests.set(id, {
        request,
        resolve,
        timer,
      });

      // Broadcast across channels
      if (this.channelManager) {
        this.channelManager.broadcastClarification(request).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.log.error({ err: msg }, "Error broadcasting clarification to channels");
        });
      }
    });
  }

  /** Submit an answer to a pending clarification */
  answer(requestId: string, answer: string, answeredBy?: string): boolean {
    const pending = this.pendingRequests.get(requestId);
    if (!pending || pending.request.status !== "pending") {
      this.log.warn({ requestId }, "Attempted to answer nonexistent or completed clarification");
      return false;
    }

    if (pending.timer) {
      clearTimeout(pending.timer);
    }

    pending.request.status = "answered";
    pending.request.answer = answer;
    pending.request.answeredBy = answeredBy || "operator";
    pending.request.answeredAt = new Date().toISOString();

    this.history.push(pending.request);
    this.pendingRequests.delete(requestId);

    this.log.info({ requestId, answer, answeredBy: pending.request.answeredBy }, "Clarification answered");
    pending.resolve(answer);
    return true;
  }

  /** Get a clarification request by ID */
  get(requestId: string): ClarificationRequest | undefined {
    return this.pendingRequests.get(requestId)?.request || this.history.find((r) => r.id === requestId);
  }

  /** List all active/pending clarification requests */
  listPending(): ClarificationRequest[] {
    return Array.from(this.pendingRequests.values()).map((p) => p.request);
  }

  /** List all historical clarification requests */
  getHistory(): ClarificationRequest[] {
    return [...this.history];
  }

  private handleTimeout(requestId: string): void {
    const pending = this.pendingRequests.get(requestId);
    if (!pending || pending.request.status !== "pending") return;

    const fallbackAnswer = pending.request.defaultValue || "";
    pending.request.status = "timed_out";
    pending.request.answer = fallbackAnswer;
    pending.request.answeredAt = new Date().toISOString();

    this.history.push(pending.request);
    this.pendingRequests.delete(requestId);

    this.log.warn({ requestId, fallbackAnswer }, "Clarification timed out — using default value");
    pending.resolve(fallbackAnswer);
  }
}
