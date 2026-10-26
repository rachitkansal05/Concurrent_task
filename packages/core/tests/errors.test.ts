import { describe, it, expect } from "vitest";
import { ConcurrentError, ToolError, PlanError, wrapError } from "../src/errors/index.js";

describe("Error Taxonomy", () => {
  it("should create ConcurrentError with code, message, and context", () => {
    const error = new ConcurrentError("PLAN_TOOL_NOT_FOUND", "Tool not found in catalog", {
      context: { tool: "browser.unknown" },
      retryable: false,
    });

    expect(error.name).toBe("ConcurrentError");
    expect(error.code).toBe("PLAN_TOOL_NOT_FOUND");
    expect(error.message).toBe("Tool not found in catalog");
    expect(error.context).toEqual({ tool: "browser.unknown" });
    expect(error.retryable).toBe(false);

    const json = error.toJSON();
    expect(json.code).toBe("PLAN_TOOL_NOT_FOUND");
    expect(json.context).toEqual({ tool: "browser.unknown" });
  });

  it("should set defaults properly for PlanError and ToolError", () => {
    const planErr = new PlanError("PLAN_GENERATION_FAILED", "Model timed out");
    expect(planErr.name).toBe("PlanError");
    expect(planErr.retryable).toBe(true);

    const toolErr = new ToolError("TOOL_EXECUTION_FAILED", "Selector not found");
    expect(toolErr.name).toBe("ToolError");
    expect(toolErr.retryable).toBe(true);
  });

  it("should wrap non-ConcurrentError instances seamlessly", () => {
    const nativeErr = new Error("Network socket disconnected");
    const wrapped = wrapError(nativeErr, { attempt: 3 });

    expect(wrapped).toBeInstanceOf(ConcurrentError);
    expect(wrapped.code).toBe("UNKNOWN_ERROR");
    expect(wrapped.message).toBe("Network socket disconnected");
    expect(wrapped.cause).toBe(nativeErr);
    expect(wrapped.context).toMatchObject({ attempt: 3, originalName: "Error" });
  });

  it("should return identical ConcurrentError when already typed", () => {
    const original = new ToolError("TOOL_TIMEOUT", "Operation exceeded 30s");
    const wrapped = wrapError(original);
    expect(wrapped).toBe(original);
  });
});
