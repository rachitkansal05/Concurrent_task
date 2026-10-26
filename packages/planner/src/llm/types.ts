/**
 * LLM Abstraction Types
 *
 * Defines unified interfaces for interacting with LLM providers
 * (OpenAI, Anthropic, Ollama, and Mock).
 */

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequestOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  systemPrompt?: string;
  responseFormat?: "text" | "json";
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Universal LLM client interface.
 */
export interface LLMClient {
  /** The provider name */
  readonly provider: string;

  /** The configured model name */
  readonly model: string;

  /**
   * Complete a raw prompt or conversation history into text.
   */
  generateText(
    promptOrMessages: string | LLMMessage[],
    options?: LLMRequestOptions,
  ): Promise<string>;

  /**
   * Complete and parse structured JSON from the model response.
   */
  generateJSON<T>(
    promptOrMessages: string | LLMMessage[],
    options?: LLMRequestOptions,
  ): Promise<T>;
}
