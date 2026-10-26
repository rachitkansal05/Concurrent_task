/**
 * Task Dependency Manager
 *
 * Tracks task DAG dependencies, pipes outputs across dependent tasks,
 * and cascades failure/cancellation when dependencies fail.
 */

import { createLogger, type Task, type Plan } from "@concurrent/core";

export class DependencyManager {
  private log = createLogger({ component: "dependency-manager" });
  private completedOutputs: Map<string, Record<string, unknown>> = new Map();
  private failedTasks: Set<string> = new Set();

  /** Record a completed task and store its output */
  recordTaskCompletion(taskId: string, output?: Record<string, unknown>): void {
    this.completedOutputs.set(taskId, output || {});
    this.log.debug({ taskId }, "Recorded task completion for dependencies");
  }

  /** Record a failed task */
  recordTaskFailure(taskId: string): void {
    this.failedTasks.add(taskId);
    this.log.warn({ taskId }, "Recorded task failure in dependency graph");
  }

  /** Check if all dependencies for a task are satisfied */
  areDependenciesSatisfied(dependsOn: string[]): boolean {
    if (dependsOn.length === 0) return true;
    return dependsOn.every((depId) => this.completedOutputs.has(depId));
  }

  /** Check if any dependency of a task has failed */
  hasFailedDependency(dependsOn: string[]): boolean {
    return dependsOn.some((depId) => this.failedTasks.has(depId));
  }

  /** Get all output data from parent tasks */
  getDependencyOutputs(dependsOn: string[]): Record<string, Record<string, unknown>> {
    const outputs: Record<string, Record<string, unknown>> = {};
    for (const depId of dependsOn) {
      if (this.completedOutputs.has(depId)) {
        outputs[depId] = this.completedOutputs.get(depId)!;
      }
    }
    return outputs;
  }

  /**
   * Resolve parameter references like {{task_abc.output.file_path}} or {{parent.output.id}}
   * across task boundaries.
   */
  resolveCrossTaskParams(
    params: Record<string, unknown>,
    dependsOn: string[]
  ): Record<string, unknown> {
    const depOutputs = this.getDependencyOutputs(dependsOn);
    const resolved: Record<string, unknown> = {};

    for (const [key, val] of Object.entries(params)) {
      if (typeof val === "string") {
        let strVal = val;
        // Match {{<taskId>.output.<field>}} or {{parent.output.<field>}}
        const templateRegex = /\{\{([^}]+)\}\}/g;
        strVal = strVal.replace(templateRegex, (match, pathStr: string) => {
          const parts = pathStr.trim().split(".");
          const source = parts[0]; // e.g. "task-1" or "parent"
          const propPath = parts.slice(parts[1] === "output" ? 2 : 1);

          let outputObj: Record<string, unknown> | undefined;
          if (source === "parent" && dependsOn.length > 0) {
            outputObj = depOutputs[dependsOn[0]];
          } else if (source in depOutputs) {
            outputObj = depOutputs[source];
          }

          if (outputObj) {
            let current: unknown = outputObj;
            for (const p of propPath) {
              if (current && typeof current === "object" && p in current) {
                current = (current as Record<string, unknown>)[p];
              } else {
                current = undefined;
                break;
              }
            }
            if (current !== undefined) return String(current);
          }
          return match;
        });

        resolved[key] = strVal;
      } else if (Array.isArray(val)) {
        resolved[key] = val.map((item) => {
          if (typeof item === "string") {
            const resObj = this.resolveCrossTaskParams({ k: item }, dependsOn);
            return resObj.k;
          }
          return item;
        });
      } else if (typeof val === "object" && val !== null) {
        resolved[key] = this.resolveCrossTaskParams(val as Record<string, unknown>, dependsOn);
      } else {
        resolved[key] = val;
      }
    }

    return resolved;
  }

  /** Pipe parent outputs into child plan steps */
  pipeOutputsIntoPlan(plan: Plan, dependsOn: string[]): Plan {
    if (dependsOn.length === 0) return plan;

    const modifiedSteps = plan.steps.map((step) => ({
      ...step,
      params: this.resolveCrossTaskParams(step.params, dependsOn),
    }));

    return {
      ...plan,
      steps: modifiedSteps,
    };
  }
}
