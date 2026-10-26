/**
 * Plan Formatter
 *
 * Renders structured Plan and Task objects into human-readable terminal visuals
 * for operator review, approvals, and execution logs.
 */

import type { Plan, Task, Step } from "@concurrent/core";

export function formatPlanForCLI(plan: Plan, task?: Task): string {
  const lines: string[] = [];

  const riskBadge = task
    ? ` [RISK: ${task.riskLevel.toUpperCase()}]`
    : "";

  lines.push("================================================================================");
  lines.push(` EXECUTION PLAN: Task ${plan.taskId}${riskBadge}`);
  if (task) {
    lines.push(` Request: "${task.request}"`);
    if (task.expandedRequest && task.expandedRequest !== task.request) {
      lines.push(` Context: ${task.expandedRequest}`);
    }
  }
  lines.push(` Revision: ${plan.revision} | Status: ${plan.status.toUpperCase()} | Steps: ${plan.steps.length}`);
  lines.push("================================================================================");

  for (const step of plan.steps) {
    const deps = step.dependsOn.length > 0 ? ` [Depends on: ${step.dependsOn.join(", ")}]` : " [Initial Step]";
    lines.push(`\n▶ Step ${step.id}: ${step.action}${deps}`);
    lines.push(`  Description: ${step.description}`);
    
    // Parameters display
    const paramEntries = Object.entries(step.params);
    if (paramEntries.length > 0) {
      lines.push(`  Parameters:`);
      for (const [key, value] of paramEntries) {
        const valStr = typeof value === "object" ? JSON.stringify(value) : String(value);
        lines.push(`    - ${key}: ${valStr}`);
      }
    }

    lines.push(`  Expected:    ${step.expected}`);
  }

  lines.push("\n--------------------------------------------------------------------------------");
  lines.push(" Dependency Flow:");
  const flow = plan.steps
    .map((s) => `(${s.id}: ${s.action})`)
    .join(" ──► ");
  lines.push(` ${flow}`);
  lines.push("================================================================================\n");

  return lines.join("\n");
}
