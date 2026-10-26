/**
 * Mock LLM Provider
 *
 * For unit tests, offline development, and deterministic plan validation.
 */

import type { LLMClient, LLMMessage, LLMRequestOptions } from "./types.js";
import { PlanError } from "@concurrent/core";

export type MockResponder = (prompt: string, options?: LLMRequestOptions) => string;

export class MockLLMClient implements LLMClient {
  readonly provider = "mock";
  readonly model: string;
  private customResponder?: MockResponder;
  private cannedResponses: string[] = [];

  constructor(model = "mock-model", customResponder?: MockResponder) {
    this.model = model;
    this.customResponder = customResponder;
  }

  setResponder(responder: MockResponder): void {
    this.customResponder = responder;
  }

  queueResponse(response: string): void {
    this.cannedResponses.push(response);
  }

  private normalizePrompt(promptOrMessages: string | LLMMessage[]): string {
    if (typeof promptOrMessages === "string") {
      return promptOrMessages;
    }
    return promptOrMessages.map((m) => `${m.role}: ${m.content}`).join("\n");
  }

  async generateText(
    promptOrMessages: string | LLMMessage[],
    options?: LLMRequestOptions,
  ): Promise<string> {
    const prompt = this.normalizePrompt(promptOrMessages);

    if (this.cannedResponses.length > 0) {
      return this.cannedResponses.shift()!;
    }

    if (this.customResponder) {
      return this.customResponder(prompt, options);
    }

    return "Mock response for prompt";
  }

  async generateJSON<T>(
    promptOrMessages: string | LLMMessage[],
    options?: LLMRequestOptions,
  ): Promise<T> {
    const text = await this.generateText(promptOrMessages, {
      ...options,
      responseFormat: "json",
    });

    try {
      // Handle markdown code blocks if the response wrapped json in ```json ... ```
      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```$/, "")
        .trim();
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new PlanError("PLAN_GENERATION_FAILED", `Failed to parse JSON from mock LLM response: ${text}`, {
        context: { rawResponse: text },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
