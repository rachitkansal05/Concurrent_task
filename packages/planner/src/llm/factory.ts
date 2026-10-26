/**
 * LLM Client Factory
 *
 * Creates the appropriate LLMClient instance based on configuration.
 */

import type { AppConfig } from "@concurrent/core";
import { PlanError } from "@concurrent/core";
import type { LLMClient } from "./types.js";
import { OpenAIClient } from "./openai.js";
import { AnthropicClient } from "./anthropic.js";
import { OllamaClient } from "./ollama.js";
import { MockLLMClient } from "./mock.js";

export function createLLMClient(config: AppConfig): LLMClient {
  const provider = (config.llm.provider || "openai").toLowerCase();

  switch (provider) {
    case "openai":
      return new OpenAIClient({
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        baseUrl: config.llm.baseUrl,
        defaultTemperature: config.llm.temperature,
        defaultMaxTokens: config.llm.maxTokens,
      });

    case "anthropic":
      return new AnthropicClient({
        apiKey: config.llm.apiKey,
        model: config.llm.model,
        baseUrl: config.llm.baseUrl,
        defaultTemperature: config.llm.temperature,
        defaultMaxTokens: config.llm.maxTokens,
      });

    case "ollama":
      return new OllamaClient({
        baseUrl: config.llm.baseUrl,
        model: config.llm.model,
        defaultTemperature: config.llm.temperature,
      });

    case "mock":
      return new MockLLMClient(config.llm.model);

    default:
      throw new PlanError(
        "CONFIG_VALIDATION_FAILED",
        `Unsupported LLM provider "${provider}". Supported providers: openai, anthropic, ollama, mock.`,
        { context: { provider } },
      );
  }
}
