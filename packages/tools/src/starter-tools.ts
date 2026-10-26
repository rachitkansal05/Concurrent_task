/**
 * Starter Core Tools
 *
 * Provides starter tool definitions with JSONSchema and validation
 * so the Planner catalog has real tools to plan against.
 */

import type { Tool, ToolRegistry, ExecutionContext, ToolResult } from "@concurrent/core";

export function createStarterTools(): Tool[] {
  return [
    {
      name: "browser.navigate",
      description: "Navigate web browser to a specified URL and wait for load",
      category: "browser",
      riskLevel: "low",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "Target URL to navigate to" },
        },
        required: ["url"],
      },
      returns: {
        type: "object",
        properties: {
          status: { type: "number" },
          finalUrl: { type: "string" },
        },
      },
      validate(params) {
        if (!params.url || typeof params.url !== "string") {
          return { valid: false, errors: ["'url' parameter is required and must be a string"] };
        }
        return { valid: true, errors: [] };
      },
      async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
        return {
          success: true,
          output: { status: 200, finalUrl: params.url },
          evidence: [{ type: "url", value: String(params.url), timestamp: new Date() }],
          durationMs: 250,
        };
      },
    },

    {
      name: "browser.click",
      description: "Click a selector on the active browser page",
      category: "browser",
      riskLevel: "medium",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS or XPath selector to click" },
          wait: { type: "boolean", description: "Wait for navigation after click" },
        },
        required: ["selector"],
      },
      returns: {
        type: "object",
        properties: { clicked: { type: "boolean" } },
      },
      validate(params) {
        if (!params.selector || typeof params.selector !== "string") {
          return { valid: false, errors: ["'selector' parameter is required and must be a string"] };
        }
        return { valid: true, errors: [] };
      },
      async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
        return {
          success: true,
          output: { clicked: true, selector: params.selector },
          evidence: [],
          durationMs: 120,
        };
      },
    },

    {
      name: "browser.download",
      description: "Trigger or wait for a file download in the browser",
      category: "browser",
      riskLevel: "low",
      parameters: {
        type: "object",
        properties: {
          waitFor: { type: "string", description: "Selector indicating download is ready" },
        },
      },
      returns: {
        type: "object",
        properties: {
          filePath: { type: "string" },
          fileSize: { type: "number" },
        },
      },
      validate(params) {
        return { valid: true, errors: [] };
      },
      async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
        const filePath = `${context.workingDir || "./evidence"}/downloaded_report.pdf`;
        return {
          success: true,
          output: { filePath, fileSize: 1048576 },
          evidence: [{ type: "file", value: filePath, timestamp: new Date() }],
          durationMs: 800,
        };
      },
    },

    {
      name: "browser.extract",
      description: "Extract text or attributes from elements on the page",
      category: "browser",
      riskLevel: "low",
      parameters: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector to extract from" },
        },
        required: ["selector"],
      },
      returns: {
        type: "object",
        properties: { text: { type: "string" } },
      },
      validate(params) {
        if (!params.selector || typeof params.selector !== "string") {
          return { valid: false, errors: ["'selector' parameter is required"] };
        }
        return { valid: true, errors: [] };
      },
      async execute(params: Record<string, unknown>): Promise<ToolResult> {
        return {
          success: true,
          output: { text: "EXP-2026-Q3-0042" },
          evidence: [{ type: "confirmation_id", value: "EXP-2026-Q3-0042", timestamp: new Date() }],
          durationMs: 90,
        };
      },
    },

    {
      name: "email.send",
      description: "Compose and send an email message with optional attachments",
      category: "email",
      riskLevel: "medium",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string", description: "Recipient email address" },
          subject: { type: "string", description: "Email subject line" },
          body: { type: "string", description: "Email message body" },
          attachments: {
            type: "array",
            description: "Array of file paths to attach",
          },
        },
        required: ["to", "subject"],
      },
      returns: {
        type: "object",
        properties: {
          messageId: { type: "string" },
          sent: { type: "boolean" },
        },
      },
      validate(params) {
        const errors: string[] = [];
        if (!params.to || typeof params.to !== "string") {
          errors.push("'to' email address is required");
        }
        if (!params.subject || typeof params.subject !== "string") {
          errors.push("'subject' is required");
        }
        return { valid: errors.length === 0, errors };
      },
      async execute(params: Record<string, unknown>): Promise<ToolResult> {
        return {
          success: true,
          output: { messageId: "msg-123456", sent: true },
          evidence: [{ type: "text", value: `Email sent to ${params.to}`, timestamp: new Date() }],
          durationMs: 300,
        };
      },
    },

    {
      name: "filesystem.read",
      description: "Read contents of a file on local filesystem",
      category: "filesystem",
      riskLevel: "low",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path to file" },
        },
        required: ["path"],
      },
      returns: {
        type: "object",
        properties: { content: { type: "string" } },
      },
      validate(params) {
        if (!params.path || typeof params.path !== "string") {
          return { valid: false, errors: ["'path' parameter is required"] };
        }
        return { valid: true, errors: [] };
      },
      async execute(params: Record<string, unknown>): Promise<ToolResult> {
        return {
          success: true,
          output: { content: "Sample file content" },
          evidence: [],
          durationMs: 40,
        };
      },
    },
  ];
}

export function registerStarterTools(registry: ToolRegistry): void {
  const tools = createStarterTools();
  for (const tool of tools) {
    if (!registry.has(tool.name)) {
      registry.register(tool);
    }
  }
}
