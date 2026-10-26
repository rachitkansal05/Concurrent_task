/**
 * Iterative Dynamic Re-planner
 *
 * Observes intermediate step results and dynamically rewrites remaining
 * plan steps if an unexpected branch, alternative path, or missing prerequisite is detected.
 */

import { createLogger, type Plan, type Step, type Task, type Observation } from "@concurrent/core";
import type { ReplanFunction } from "../types.js";

export class IterativeReplanner {
  private log = createLogger({ component: "iterative-replanner" });

  constructor(private replanFn?: ReplanFunction) {}

  /** Set custom re-planning function */
  setReplanFunction(fn: ReplanFunction): void {
    this.replanFn = fn;
  }

  /**
   * Evaluate whether an intermediate step observation requires dynamic re-planning.
   */
  shouldReplan(step: Step, observation: Observation): boolean {
    // 1. Tool execution failed
    if (!observation.success) return true;

    // 2. Output explicitly requests replan (e.g., dynamic branching detected)
    if (observation.output && observation.output.requiresReplan === true) {
      return true;
    }

    // 3. Status is divergent or alternative path requested
    if (observation.output && observation.output.branch) {
      return true;
    }

    return false;
  }

  /**
   * Execute dynamic re-planning: keep completed steps, replace pending steps with revised plan.
   */
  async replan(
    task: Task,
    currentPlan: Plan,
    triggerStep: Step,
    observation: Observation
  ): Promise<Plan> {
    this.log.info(
      { taskId: task.id, triggerStepId: triggerStep.id, planRevision: currentPlan.revision },
      "Triggering dynamic re-planning"
    );

    if (this.replanFn) {
      const newPlan = await this.replanFn(task, currentPlan, triggerStep, observation);
      return {
        ...newPlan,
        revision: currentPlan.revision + 1,
      };
    }

    // Default built-in dynamic splice heuristic:
    // If output specifies new alternative steps, append them
    const completedSteps = currentPlan.steps.filter(
      (s) => s.id <= triggerStep.id && s.status === "success"
    );

    let nextStepId = triggerStep.id + 1;
    let replacementSteps: Step[] = [];

    if (observation.output && Array.isArray(observation.output.alternativeSteps)) {
      replacementSteps = (observation.output.alternativeSteps as Array<Partial<Step>>).map(
        (alt, idx) => ({
          id: nextStepId + idx,
          action: alt.action || "browser.navigate",
          params: alt.params || {},
          dependsOn: alt.dependsOn || [nextStepId + idx - 1],
          description: alt.description || `Alternative step ${idx + 1}`,
          expected: alt.expected || "Alternative step completed",
          status: "pending",
          evidence: [],
          retryCount: 0,
          maxRetries: 2,
        })
      );
    } else {
      // Keep remaining steps as is
      replacementSteps = currentPlan.steps.filter((s) => s.id > triggerStep.id);
    }

    const revisedPlan: Plan = {
      ...currentPlan,
      revision: currentPlan.revision + 1,
      steps: [...completedSteps, ...replacementSteps],
    };

    this.log.info(
      {
        taskId: task.id,
        newRevision: revisedPlan.revision,
        totalSteps: revisedPlan.steps.length,
      },
      "Plan dynamically updated"
    );

    return revisedPlan;
  }
}
