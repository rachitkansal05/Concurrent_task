/**
 * Data matching and pattern post-condition checks
 */

import type { CheckContext, ConditionCheckResult, PostCondition } from "../../types.js";

/** Check if any step output or evidence value matches a regex pattern */
export async function checkDataMatchesPattern(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const patternStr = String(condition.params.pattern ?? "");
  const field = condition.params.field ? String(condition.params.field) : undefined;
  const stepId = typeof condition.params.stepId === "number" ? condition.params.stepId : undefined;

  let valuesToTest: string[] = [];

  // Check specific field or all step output values
  if (context.stepOutputs) {
    for (const [sIdStr, output] of Object.entries(context.stepOutputs)) {
      const sId = Number(sIdStr);
      if (stepId !== undefined && sId !== stepId) continue;

      if (field && field in output) {
        valuesToTest.push(String(output[field]));
      } else if (!field) {
        for (const val of Object.values(output)) {
          if (typeof val === "string" || typeof val === "number") {
            valuesToTest.push(String(val));
          }
        }
      }
    }
  }

  // Also check evidence values
  for (const ev of context.evidenceList) {
    if (stepId !== undefined && ev.stepId !== stepId) continue;
    valuesToTest.push(ev.value);
  }

  const regex = new RegExp(patternStr);
  const matched = valuesToTest.find((v) => regex.test(v));

  return {
    conditionId: condition.id,
    name: condition.name,
    type: condition.type,
    passed: Boolean(matched),
    score: matched ? 1.0 : 0.0,
    weight: condition.weight ?? 1.0,
    critical: condition.critical ?? false,
    message: matched
      ? `Data matched pattern '${patternStr}' (value: '${matched}')`
      : `No data matched pattern '${patternStr}'`,
    details: { pattern: patternStr, matchedValue: matched },
    durationMs: Date.now() - start,
  };
}

/** Check if a specific data field equals an expected value */
export async function checkDataFieldEquals(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const field = String(condition.params.field ?? "");
  const expected = condition.params.expected;
  const stepId = typeof condition.params.stepId === "number" ? condition.params.stepId : undefined;

  let actual: unknown = undefined;
  let found = false;

  if (context.stepOutputs) {
    for (const [sIdStr, output] of Object.entries(context.stepOutputs)) {
      const sId = Number(sIdStr);
      if (stepId !== undefined && sId !== stepId) continue;

      if (field in output) {
        actual = output[field];
        found = true;
        break;
      }
    }
  }

  if (!found && context.customData && field in context.customData) {
    actual = context.customData[field];
    found = true;
  }

  const passed = found && (actual === expected || String(actual) === String(expected));

  return {
    conditionId: condition.id,
    name: condition.name,
    type: condition.type,
    passed,
    score: passed ? 1.0 : 0.0,
    weight: condition.weight ?? 1.0,
    critical: condition.critical ?? false,
    message: passed
      ? `Field '${field}' equals expected value (${JSON.stringify(actual)})`
      : `Field '${field}' mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    details: { field, expected, actual },
    durationMs: Date.now() - start,
  };
}
