import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistryImpl } from "../src/registry.js";
import type { Tool, ExecutionContext, ToolResult } from "../src/types/tool.js";

describe("Tool Registry", () => {
  let registry: ToolRegistryImpl;

  const mockTool: Tool = {
    name: "browser.navigate",
    description: "Navigate browser to a given URL",
    category: "browser",
    riskLevel: "low",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Destination URL" },
      },
      required: ["url"],
    },
    returns: {
      type: "object",
      properties: {
        status: { type: "number" },
      },
    },
    validate(params) {
      if (typeof params.url !== "string") {
        return { valid: false, errors: ["url must be string"] };
      }
      return { valid: true, errors: [] };
    },
    async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
      return {
        success: true,
        output: { status: 200, url: params.url },
        evidence: [],
        durationMs: 150,
      };
    },
  };

  beforeEach(() => {
    registry = new ToolRegistryImpl();
  });

  it("should register and retrieve a tool", () => {
    registry.register(mockTool);
    expect(registry.has("browser.navigate")).toBe(true);
    expect(registry.get("browser.navigate")).toBe(mockTool);
  });

  it("should prevent duplicate registration", () => {
    registry.register(mockTool);
    expect(() => registry.register(mockTool)).toThrowError(/already registered/);
  });

  it("should list registered tools", () => {
    registry.register(mockTool);
    expect(registry.list()).toEqual(["browser.navigate"]);
  });

  it("should generate a clean catalog for LLM consumption", () => {
    registry.register(mockTool);
    const catalog = registry.catalog();
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toEqual({
      name: "browser.navigate",
      description: "Navigate browser to a given URL",
      category: "browser",
      riskLevel: "low",
      parameters: mockTool.parameters,
      returns: mockTool.returns,
    });
  });

  it("should filter by category", () => {
    registry.register(mockTool);
    expect(registry.byCategory("browser")).toHaveLength(1);
    expect(registry.byCategory("email")).toHaveLength(0);
  });
});
