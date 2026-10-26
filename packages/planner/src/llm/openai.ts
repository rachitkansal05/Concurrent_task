/**
 * OpenAI Provider
 *
 * Implements LLMClient using OpenAI's Chat Completions REST API.
 */

import type { LLMClient, LLMMessage, LLMRequestOptions } from "./types.js";
import { PlanError, AuthError } from "@concurrent/core";

export interface OpenAIConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export class OpenAIClient implements LLMClient {
  readonly provider = "openai";
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;

  constructor(config: OpenAIConfig = {}) {
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || "gpt-4o";
    this.baseUrl = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.defaultTemperature = config.defaultTemperature ?? 0.2;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new AuthError(
        "AUTH_CREDENTIALS_MISSING",
        "OpenAI API key is missing. Set OPENAI_API_KEY in .env or config.",
      );
    }
    return this.apiKey;
  }

  private toMessages(
    promptOrMessages: string | LLMMessage[],
    systemPrompt?: string,
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];

    if (systemPrompt) {
      messages.push({ role: "system", content: systemPrompt });
    }

    if (typeof promptOrMessages === "string") {
      messages.push({ role: "user", content: promptOrMessages });
    } else {
      messages.push(...promptOrMessages);
    }

    return messages;
  }

  async generateText(
    promptOrMessages: string | LLMMessage[],
    options: LLMRequestOptions = {},
  ): Promise<string> {
    const apiKey = this.ensureApiKey();
    const messages = this.toMessages(promptOrMessages, options.systemPrompt);

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      temperature: options.temperature ?? this.defaultTemperature,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
    };

    if (options.responseFormat === "json") {
      body.response_format = { type: "json_object" };
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PlanError(
          "PLAN_GENERATION_FAILED",
          `OpenAI API request failed (${response.status}): ${errorText}`,
          { context: { status: response.status, body: errorText } },
        );
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };

      const choice = data.choices[0];
      if (!choice || !choice.message) {
        throw new PlanError("PLAN_GENERATION_FAILED", "OpenAI returned empty choices in response");
      }

      return choice.message.content;
    } catch (err) {
      if (err instanceof PlanError || err instanceof AuthError) throw err;
      throw new PlanError("PLAN_GENERATION_FAILED", `OpenAI call failed: ${String(err)}`, {
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
      throw new PlanError("PLAN_GENERATION_FAILED", `Failed to parse JSON from OpenAI response: ${text}`, {
        context: { rawResponse: text },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
