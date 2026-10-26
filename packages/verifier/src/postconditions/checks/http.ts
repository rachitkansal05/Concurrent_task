/**
 * HTTP & API post-condition checks
 */

import type { CheckContext, ConditionCheckResult, PostCondition } from "../../types.js";

/** Check HTTP response status code (from step output or via request) */
export async function checkHttpStatus(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const expectedStatus = typeof condition.params.status === "number" ? condition.params.status : 200;
  const stepId = typeof condition.params.stepId === "number" ? condition.params.stepId : undefined;

  let actualStatus: number | undefined;

  // 1. Check step output if stepId provided
  if (stepId !== undefined && context.stepOutputs && context.stepOutputs[stepId]) {
    const output = context.stepOutputs[stepId];
    if (typeof output.status === "number") {
      actualStatus = output.status;
    } else if (typeof output.statusCode === "number") {
      actualStatus = output.statusCode;
    }
  }

  // 2. Or check evidence list for API response evidence
  if (actualStatus === undefined) {
    const apiEvidence = context.evidenceList.find(
      (e) => e.type === "api_response" && (stepId === undefined || e.stepId === stepId)
    );
    if (apiEvidence && apiEvidence.metadata && typeof apiEvidence.metadata.status === "number") {
      actualStatus = apiEvidence.metadata.status as number;
    }
  }

  // 3. Or direct URL fetch if url provided in params
  if (actualStatus === undefined && typeof condition.params.url === "string") {
    try {
      const response = await fetch(condition.params.url, {
        method: (condition.params.method as string) || "GET",
      });
      actualStatus = response.status;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return {
        conditionId: condition.id,
        name: condition.name,
        type: condition.type,
        passed: false,
        score: 0.0,
        weight: condition.weight ?? 1.0,
        critical: condition.critical ?? false,
        message: `HTTP request failed to ${condition.params.url}: ${errMsg}`,
        durationMs: Date.now() - start,
      };
    }
  }

  if (actualStatus === undefined) {
    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: false,
      score: 0.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `No HTTP status could be retrieved from step ${stepId ?? "any"} or URL`,
      durationMs: Date.now() - start,
    };
  }

  const passed = actualStatus === expectedStatus;
  return {
    conditionId: condition.id,
    name: condition.name,
    type: condition.type,
    passed,
    score: passed ? 1.0 : 0.0,
    weight: condition.weight ?? 1.0,
    critical: condition.critical ?? false,
    message: passed
      ? `HTTP status matched expected ${expectedStatus}`
      : `HTTP status mismatch: expected ${expectedStatus}, got ${actualStatus}`,
    details: { expectedStatus, actualStatus },
    durationMs: Date.now() - start,
  };
}

/** Check JSON response fields */
export async function checkHttpJsonField(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const fieldPath = String(condition.params.field ?? "");
  const expectedValue = condition.params.expected;
  const stepId = typeof condition.params.stepId === "number" ? condition.params.stepId : undefined;

  let body: Record<string, unknown> | undefined;

  // Retrieve body from step output
  if (stepId !== undefined && context.stepOutputs && context.stepOutputs[stepId]) {
    const out = context.stepOutputs[stepId];
    if (typeof out.body === "object" && out.body !== null) {
      body = out.body as Record<string, unknown>;
    } else if (typeof out.json === "object" && out.json !== null) {
      body = out.json as Record<string, unknown>;
    } else if (typeof out.data === "object" && out.data !== null) {
      body = out.data as Record<string, unknown>;
    }
  }

  // Or from evidence
  if (!body) {
    const apiEvidence = context.evidenceList.find(
      (e) => e.type === "api_response" && (stepId === undefined || e.stepId === stepId)
    );
    if (apiEvidence) {
      try {
        body = JSON.parse(apiEvidence.value);
      } catch {
        // value is not JSON
      }
    }
  }

  if (!body) {
    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: false,
      score: 0.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `No JSON response body found for step ${stepId ?? "any"}`,
      durationMs: Date.now() - start,
    };
  }

  // Resolve nested dot notation e.g. "user.profile.id"
  const keys = fieldPath.split(".");
  let current: unknown = body;
  for (const k of keys) {
    if (current && typeof current === "object" && k in (current as Record<string, unknown>)) {
      current = (current as Record<string, unknown>)[k];
    } else {
      current = undefined;
      break;
    }
  }

  let passed = false;
  if (expectedValue !== undefined) {
    passed = current === expectedValue || String(current) === String(expectedValue);
  } else {
    // If expected is not specified, check field presence (not undefined/null)
    passed = current !== undefined && current !== null;
  }

  return {
    conditionId: condition.id,
    name: condition.name,
    type: condition.type,
    passed,
    score: passed ? 1.0 : 0.0,
    weight: condition.weight ?? 1.0,
    critical: condition.critical ?? false,
    message: passed
      ? `JSON field '${fieldPath}' matched (${JSON.stringify(current)})`
      : `JSON field '${fieldPath}' mismatch: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(current)}`,
    details: { fieldPath, expectedValue, actualValue: current },
    durationMs: Date.now() - start,
  };
}
