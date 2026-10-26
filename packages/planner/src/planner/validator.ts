/**
 * Plan Validator
 *
 * Verifies that a generated plan is structurally sound,
 * references only available tools with valid arguments,
 * and possesses an acyclic dependency graph.
 */

import type { Plan, Step, ToolRegistry, ValidationResult } from "@concurrent/core";

export class PlanValidator {
  constructor(private toolRegistry: ToolRegistry) {}

  /**
   * Validate an entire Plan against registered tools and graph constraints.
   */
  validate(plan: Plan): ValidationResult {
    const errors: string[] = [];

    if (!plan.steps || plan.steps.length === 0) {
      return { valid: false, errors: ["Plan contains no execution steps."] };
    }

    const stepIdSet = new Set<number>();
    const graph = new Map<number, number[]>();

    // Step 1: Validate individual steps & build dependency graph
    for (const step of plan.steps) {
      if (typeof step.id !== "number") {
        errors.push(`Step is missing a numeric id.`);
        continue;
      }

      if (stepIdSet.has(step.id)) {
        errors.push(`Duplicate step id ${step.id} detected.`);
      }
      stepIdSet.add(step.id);

      // Verify tool exists in registry
      const tool = this.toolRegistry.get(step.action);
      if (!tool) {
        errors.push(
          `Step ${step.id} references unregistered tool "${step.action}". Available tools: ${this.toolRegistry.list().join(", ")}`,
        );
      } else {
        // Validate parameters against tool's validation logic
        const paramValidation = tool.validate(step.params || {});
        if (!paramValidation.valid) {
          errors.push(
            `Step ${step.id} (${step.action}) parameter validation failed: ${paramValidation.errors.join("; ")}`,
          );
        }
      }

      // Check dependsOn validity
      const deps = step.dependsOn || [];
      graph.set(step.id, deps);

      for (const depId of deps) {
        if (depId === step.id) {
          errors.push(`Step ${step.id} depends on itself.`);
        }
      }
    }

    // Step 2: Validate that all dependency IDs exist
    for (const [stepId, deps] of graph.entries()) {
      for (const depId of deps) {
        if (!stepIdSet.has(depId)) {
          errors.push(`Step ${stepId} depends on non-existent step id ${depId}.`);
        }
      }
    }

    // Step 3: Cycle Detection via DFS (topological sort check)
    const visited = new Map<number, "unvisited" | "visiting" | "visited">();
    for (const id of stepIdSet) {
      visited.set(id, "unvisited");
    }

    const hasCycle = (node: number, path: number[]): boolean => {
      visited.set(node, "visiting");
      path.push(node);

      const neighbors = graph.get(node) || [];
      for (const neighbor of neighbors) {
        const state = visited.get(neighbor);
        if (state === "visiting") {
          errors.push(`Dependency cycle detected: ${[...path, neighbor].join(" -> ")}`);
          return true;
        }
        if (state === "unvisited") {
          if (hasCycle(neighbor, path)) return true;
        }
      }

      visited.set(node, "visited");
      path.pop();
      return false;
    };

    for (const id of stepIdSet) {
      if (visited.get(id) === "unvisited") {
        hasCycle(id, []);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}
