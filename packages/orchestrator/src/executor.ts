/**
 * Plan Executor
 *
 * Executes a verified Plan step-by-step, piping data between steps,
 * capturing evidence artifacts, and updating step statuses.
 */

import type { Plan, Task, Step, ToolRegistry, ExecutionContext, Evidence } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";

const log = createLogger({ component: "plan-executor" });

export interface ExecutionReport {
  taskId: string;
  success: boolean;
  stepsCompleted: number;
  totalSteps: number;
  durationMs: number;
  evidence: Evidence[];
  error?: string;
}

export class PlanExecutor {
  constructor(private toolRegistry: ToolRegistry) {}

  /**
   * Resolve template variables in step parameters from previous step outputs.
   * Example: "{{step_1.output.url}}" -> resolves to previousOutputs.get(1).url
   */
  private resolveParams(
    params: Record<string, unknown> | undefined,
    previousOutputs: Map<number, Record<string, unknown>>,
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(params || {})) {
      if (typeof value === "string") {
        let text = value;
        const matches = text.matchAll(/\{\{step_(\d+)\.output\.([a-zA-Z0-9_]+)\}\}/g);
        for (const match of matches) {
          const stepId = parseInt(match[1], 10);
          const field = match[2];
          const prevOutput = previousOutputs.get(stepId);
          if (prevOutput && prevOutput[field] !== undefined) {
            text = text.replace(match[0], String(prevOutput[field]));
          }
        }
        resolved[key] = text;
      } else if (Array.isArray(value)) {
        resolved[key] = value.map((item) => {
          if (typeof item === "string") {
            let text = item;
            const matches = text.matchAll(/\{\{step_(\d+)\.output\.([a-zA-Z0-9_]+)\}\}/g);
            for (const match of matches) {
              const stepId = parseInt(match[1], 10);
              const field = match[2];
              const prevOutput = previousOutputs.get(stepId);
              if (prevOutput && prevOutput[field] !== undefined) {
                text = text.replace(match[0], String(prevOutput[field]));
              }
            }
            return text;
          }
          return item;
        });
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Execute an entire Plan.
   */
  async executePlan(
    task: Task,
    plan: Plan,
    options: Partial<ExecutionContext> = {},
  ): Promise<ExecutionReport> {
    const startTime = Date.now();
    log.info({ taskId: task.id, stepCount: plan.steps.length }, "Starting plan execution");

    task.status = "executing";
    plan.status = "executing";

    const previousOutputs = new Map<number, Record<string, unknown>>();
    const allEvidence: Evidence[] = [];
    let stepsCompleted = 0;

    for (const step of plan.steps) {
      log.info({ stepId: step.id, action: step.action }, `Executing Step ${step.id}: ${step.action}`);
      step.status = "running";
      step.startedAt = new Date();

      const tool = this.toolRegistry.get(step.action);
      if (!tool) {
        step.status = "failed";
        step.error = `Tool "${step.action}" is not registered in tool registry.`;
        task.status = "failed";
        plan.status = "failed";
        return {
          taskId: task.id,
          success: false,
          stepsCompleted,
          totalSteps: plan.steps.length,
          durationMs: Date.now() - startTime,
          evidence: allEvidence,
          error: step.error,
        };
      }

      // Resolve parameter templates from prior outputs
      const resolvedParams = this.resolveParams(step.params, previousOutputs);

      // Validate parameters
      const validation = tool.validate(resolvedParams);
      if (!validation.valid) {
        step.status = "failed";
        step.error = `Parameter validation failed: ${validation.errors.join("; ")}`;
        task.status = "failed";
        plan.status = "failed";
        return {
          taskId: task.id,
          success: false,
          stepsCompleted,
          totalSteps: plan.steps.length,
          durationMs: Date.now() - startTime,
          evidence: allEvidence,
          error: step.error,
        };
      }

      // Prepare context for this step
      const context: ExecutionContext = {
        taskId: task.id,
        stepId: step.id,
        workingDir: options.workingDir || "./evidence",
        previousOutputs,
        allowedDomains: options.allowedDomains || [],
        allowedPaths: options.allowedPaths || [],
        dryRun: options.dryRun ?? false,
        signal: options.signal,
      };

      // Execute tool with retry logic
      const maxRetries = typeof step.maxRetries === "number" && step.maxRetries >= 0 ? step.maxRetries : 2;
      let attempt = 0;
      let lastError = "";
      let executionSuccess = false;

      while (attempt <= maxRetries) {
        attempt++;
        try {
          const result = await tool.execute(resolvedParams, context);

          if (!result.success) {
            lastError = result.error || "Tool returned failure status without error message.";
            if (attempt <= maxRetries) {
              const backoffMs = Math.min(200 * Math.pow(2, attempt - 1), 2000);
              log.warn(
                { stepId: step.id, attempt, maxRetries, backoffMs, err: lastError },
                `Step ${step.id} failed; retrying with backoff`
              );
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
              continue;
            }
            break;
          }

          // Successful execution
          step.status = "success";
          step.completedAt = new Date();
          step.output = result.output;
          step.evidence = result.evidence;

          previousOutputs.set(step.id, result.output);
          if (result.evidence) {
            allEvidence.push(...result.evidence);
            if (!task.evidence) task.evidence = [];
            task.evidence.push(...result.evidence);
          }
          stepsCompleted++;
          executionSuccess = true;

          log.info({ stepId: step.id, durationMs: result.durationMs, attempts: attempt }, `Step ${step.id} completed successfully`);
          break;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          if (attempt <= maxRetries) {
            const backoffMs = Math.min(200 * Math.pow(2, attempt - 1), 2000);
            log.warn(
              { stepId: step.id, attempt, maxRetries, backoffMs, err: lastError },
              `Step ${step.id} threw error; retrying with backoff`
            );
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
          break;
        }
      }

      if (!executionSuccess) {
        step.status = "failed";
        step.error = lastError;
        task.status = "failed";
        plan.status = "failed";
        log.error({ stepId: step.id, err: lastError, totalAttempts: attempt }, `Step ${step.id} failed after all retries`);

        return {
          taskId: task.id,
          success: false,
          stepsCompleted,
          totalSteps: plan.steps.length,
          durationMs: Date.now() - startTime,
          evidence: allEvidence,
          error: step.error,
        };
      }
    }

    plan.status = "completed";
    task.status = "verifying";

    log.info(
      { taskId: task.id, totalSteps: plan.steps.length, durationMs: Date.now() - startTime },
      "All plan steps executed successfully",
    );

    return {
      taskId: task.id,
      success: true,
      stepsCompleted,
      totalSteps: plan.steps.length,
      durationMs: Date.now() - startTime,
      evidence: allEvidence,
    };
  }
}
