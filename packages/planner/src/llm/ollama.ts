/**
 * Ollama Provider
 *
 * Implements LLMClient using local Ollama instance for on-premise execution.
 */

import type { LLMClient, LLMMessage, LLMRequestOptions } from "./types.js";
import { PlanError } from "@concurrent/core";

export interface OllamaConfig {
  baseUrl?: string;
  model?: string;
  defaultTemperature?: number;
}

export class OllamaClient implements LLMClient {
  readonly provider = "ollama";
  readonly model: string;
  private readonly baseUrl: string;
  private readonly defaultTemperature: number;

  constructor(config: OllamaConfig = {}) {
    this.baseUrl = (config.baseUrl || "http://localhost:11434").replace(/\/$/, "");
    this.model = config.model || "llama3";
    this.defaultTemperature = config.defaultTemperature ?? 0.2;
  }

  async generateText(
    promptOrMessages: string | LLMMessage[],
    options: LLMRequestOptions = {},
  ): Promise<string> {
    const messages: Array<{ role: string; content: string }> = [];

    if (options.systemPrompt) {
      messages.push({ role: "system", content: options.systemPrompt });
    }

    if (typeof promptOrMessages === "string") {
      messages.push({ role: "user", content: promptOrMessages });
    } else {
      messages.push(...promptOrMessages);
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? this.defaultTemperature,
      },
    };

    if (options.responseFormat === "json") {
      body.format = "json";
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PlanError(
          "PLAN_GENERATION_FAILED",
          `Ollama request failed (${response.status}): ${errorText}`,
          { context: { status: response.status, body: errorText } },
        );
      }

      const data = (await response.json()) as { message?: { content?: string } };
      if (!data.message?.content) {
        throw new PlanError("PLAN_GENERATION_FAILED", "Ollama returned empty response content");
      }

      return data.message.content;
    } catch (err) {
      if (err instanceof PlanError) throw err;
      throw new PlanError("PLAN_GENERATION_FAILED", `Ollama connection failed: ${String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  async generateJSON<T>(
    promptOrMessages: string | LLMMessage[],
    options: LLMRequestOptions = {},
  ): Promise<T> {
    const text = await this.generateText(promptOrMessages, {
      ...options,
      responseFormat: "json",
    });

    try {
      const cleaned = text
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/, "")
        .replace(/```$/, "")
        .trim();
      return JSON.parse(cleaned) as T;
    } catch (err) {
      throw new PlanError("PLAN_GENERATION_FAILED", `Failed to parse JSON from Ollama response: ${text}`, {
        context: { rawResponse: text },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
