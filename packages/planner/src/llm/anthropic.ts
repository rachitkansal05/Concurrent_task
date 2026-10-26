/**
 * Anthropic Provider
 *
 * Implements LLMClient using Anthropic's Messages REST API.
 */

import type { LLMClient, LLMMessage, LLMRequestOptions } from "./types.js";
import { PlanError, AuthError } from "@concurrent/core";

export interface AnthropicConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export class AnthropicClient implements LLMClient {
  readonly provider = "anthropic";
  readonly model: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly defaultTemperature: number;
  private readonly defaultMaxTokens: number;

  constructor(config: AnthropicConfig = {}) {
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.model = config.model || "claude-3-5-sonnet-20241022";
    this.baseUrl = (config.baseUrl || "https://api.anthropic.com/v1").replace(/\/$/, "");
    this.defaultTemperature = config.defaultTemperature ?? 0.2;
    this.defaultMaxTokens = config.defaultMaxTokens ?? 4096;
  }

  private ensureApiKey(): string {
    if (!this.apiKey) {
      throw new AuthError(
        "AUTH_CREDENTIALS_MISSING",
        "Anthropic API key is missing. Set ANTHROPIC_API_KEY in .env or config.",
      );
    }
    return this.apiKey;
  }

  async generateText(
    promptOrMessages: string | LLMMessage[],
    options: LLMRequestOptions = {},
  ): Promise<string> {
    const apiKey = this.ensureApiKey();

    const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

    if (typeof promptOrMessages === "string") {
      messages.push({ role: "user", content: promptOrMessages });
    } else {
      for (const m of promptOrMessages) {
        if (m.role === "system") {
          // Anthropic accepts system prompt as top-level parameter
          options.systemPrompt = (options.systemPrompt ? `${options.systemPrompt}\n` : "") + m.content;
        } else {
          messages.push({ role: m.role, content: m.content });
        }
      }
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      temperature: options.temperature ?? this.defaultTemperature,
    };

    if (options.systemPrompt) {
      body.system = options.systemPrompt;
    }

    try {
      const response = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify(body),
        signal: options.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PlanError(
          "PLAN_GENERATION_FAILED",
          `Anthropic API request failed (${response.status}): ${errorText}`,
          { context: { status: response.status, body: errorText } },
        );
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const textBlock = data.content.find((b) => b.type === "text" && b.text);
      if (!textBlock || !textBlock.text) {
        throw new PlanError("PLAN_GENERATION_FAILED", "Anthropic returned empty message text");
      }

      return textBlock.text;
    } catch (err) {
      if (err instanceof PlanError || err instanceof AuthError) throw err;
      throw new PlanError("PLAN_GENERATION_FAILED", `Anthropic call failed: ${String(err)}`, {
        cause: err instanceof Error ? err : undefined,
      });
    }
  }

  async generateJSON<T>(
    promptOrMessages: string | LLMMessage[],
    options: LLMRequestOptions = {},
  ): Promise<T> {
    const jsonInstructions = "You MUST respond with valid JSON only. Do not include markdown formatting or commentary.";
    const systemPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\n${jsonInstructions}`
      : jsonInstructions;

    const text = await this.generateText(promptOrMessages, {
      ...options,
      systemPrompt,
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
      throw new PlanError("PLAN_GENERATION_FAILED", `Failed to parse JSON from Anthropic response: ${text}`, {
        context: { rawResponse: text },
        cause: err instanceof Error ? err : undefined,
      });
    }
  }
}
