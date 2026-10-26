/**
 * ToolRegistry — Manages all available tools.
 *
 * Tools register themselves here at startup.
 * The planner queries the catalog to know what tools are available.
 *
 * Usage:
 *   const registry = new ToolRegistryImpl();
 *   registry.register(new BrowserNavigateTool());
 *   registry.register(new EmailSendTool());
 *
 *   // Get catalog for LLM prompt
 *   const catalog = registry.catalog();
 *
 *   // Execute a tool
 *   const tool = registry.get("browser.navigate");
 *   const result = await tool.execute(params, context);
 */

import type { Tool, ToolRegistry, ToolCatalogEntry } from "./types/tool.js";
import { ConcurrentError } from "./errors/errors.js";
import { createLogger } from "./logging/logger.js";

const log = createLogger({ component: "tool-registry" });

export class ToolRegistryImpl implements ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool. Throws if a tool with the same name is already registered.
   */
  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new ConcurrentError("TOOL_NOT_REGISTERED", `Tool "${tool.name}" is already registered`, {
        context: { toolName: tool.name },
      });
    }
    this.tools.set(tool.name, tool);
    log.info({ tool: tool.name, category: tool.category, risk: tool.riskLevel }, `Tool registered: ${tool.name}`);
  }

  /**
   * Get a tool by name. Returns undefined if not found.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool is registered.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all registered tool names.
   */
  list(): string[] {
    return Array.from(this.tools.keys());
  }

  /**
   * Get catalog entries for all tools.
   * This is the serializable format included in LLM prompts.
   */
  catalog(): ToolCatalogEntry[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      category: tool.category,
      parameters: tool.parameters,
      returns: tool.returns,
      riskLevel: tool.riskLevel,
    }));
  }

  /**
   * Get all tools in a specific category.
   */
  byCategory(category: string): Tool[] {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.category === category,
    );
  }
}
