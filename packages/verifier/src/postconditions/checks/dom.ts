/**
 * DOM and browser post-condition checks
 */

import type { CheckContext, ConditionCheckResult, PostCondition } from "../../types.js";

/** Check if a DOM element or selector is present in extraction outputs */
export async function checkDomElementPresent(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const selector = String(condition.params.selector ?? "");
  const stepId = typeof condition.params.stepId === "number" ? condition.params.stepId : undefined;

  let found = false;
  let matchedValue: unknown;

  // Search in step outputs
  if (context.stepOutputs) {
    for (const [sIdStr, output] of Object.entries(context.stepOutputs)) {
      const sId = Number(sIdStr);
      if (stepId !== undefined && sId !== stepId) continue;

      if (output.selector === selector || output.element === selector) {
        found = true;
        matchedValue = output.value ?? output.text ?? true;
        break;
      }
      if (typeof output.extractedText === "string" && output.extractedText.length > 0) {
        found = true;
        matchedValue = output.extractedText;
        break;
      }
    }
  }

  // Search in evidence list (text or confirmation_id or url)
  if (!found) {
    const matchedEvidence = context.evidenceList.find((e) => {
      if (stepId !== undefined && e.stepId !== stepId) return false;
      return (
        (e.type === "text" || e.type === "confirmation_id") &&
        (e.metadata?.selector === selector || e.value.length > 0)
      );
    });

    if (matchedEvidence) {
      found = true;
      matchedValue = matchedEvidence.value;
    }
  }

  return {
    conditionId: condition.id,
    name: condition.name,
    type: condition.type,
    passed: found,
    score: found ? 1.0 : 0.0,
    weight: condition.weight ?? 1.0,
    critical: condition.critical ?? false,
    message: found
      ? `DOM element/text for selector '${selector}' was verified`
      : `DOM selector '${selector}' was not found in step outputs or evidence`,
    details: { selector, matchedValue },
    durationMs: Date.now() - start,
  };
}

/** Check if DOM text contains expected substring or regex */
export async function checkDomTextContains(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const pattern = String(condition.params.pattern ?? "");
  const isRegex = Boolean(condition.params.isRegex);
  const stepId = typeof condition.params.stepId === "number" ? condition.params.stepId : undefined;

  let textToSearch = "";

  // Collect all text from matching step outputs
  if (context.stepOutputs) {
    for (const [sIdStr, output] of Object.entries(context.stepOutputs)) {
      const sId = Number(sIdStr);
      if (stepId !== undefined && sId !== stepId) continue;

      for (const val of Object.values(output)) {
        if (typeof val === "string") {
          textToSearch += " " + val;
        }
      }
    }
  }

  // Also collect text from evidence
  for (const ev of context.evidenceList) {
    if (stepId !== undefined && ev.stepId !== stepId) continue;
    if (ev.type === "text" || ev.type === "confirmation_id" || ev.type === "url") {
      textToSearch += " " + ev.value;
    }
  }

  let matched = false;
  if (isRegex) {
    try {
      matched = new RegExp(pattern, "i").test(textToSearch);
    } catch {
      matched = false;
    }
  } else {
    matched = textToSearch.toLowerCase().includes(pattern.toLowerCase());
  }

  return {
    conditionId: condition.id,
    name: condition.name,
    type: condition.type,
    passed: matched,
    score: matched ? 1.0 : 0.0,
    weight: condition.weight ?? 1.0,
    critical: condition.critical ?? false,
    message: matched
      ? `DOM text contained expected content '${pattern}'`
      : `DOM text did not contain '${pattern}'`,
    details: { pattern, isRegex, searchedLength: textToSearch.length },
    durationMs: Date.now() - start,
  };
}
