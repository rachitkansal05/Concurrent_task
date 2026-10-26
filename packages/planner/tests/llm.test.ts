import { describe, it, expect } from "vitest";
import { MockLLMClient, createLLMClient } from "../src/llm/index.js";
import { loadConfig } from "@concurrent/core";

describe("LLM Abstraction Layer", () => {
  it("should generate text using MockLLMClient", async () => {
    const mock = new MockLLMClient("test-model");
    mock.queueResponse("Hello from mock LLM");

    const response = await mock.generateText("Say hello");
    expect(response).toBe("Hello from mock LLM");
  });

  it("should generate JSON using MockLLMClient", async () => {
    const mock = new MockLLMClient();
    mock.queueResponse(JSON.stringify({ status: "success", count: 42 }));

    const parsed = await mock.generateJSON<{ status: string; count: number }>("Give data");
    expect(parsed.status).toBe("success");
    expect(parsed.count).toBe(42);
  });

  it("should instantiate Mock client via factory when provider is mock", () => {
    const config = loadConfig();
    config.llm.provider = "mock";
    const client = createLLMClient(config);

    expect(client.provider).toBe("mock");
  });
});
