/**
 * Post-condition Engine
 *
 * Orchestrates programmatic checks against execution outputs and evidence.
 */

import { createLogger } from "@concurrent/core";
import type { CheckContext, ConditionCheckResult, PostCondition, PostConditionType } from "../types.js";
import { checkFileExists, checkFileHash, checkFileSize, checkFileContains } from "./checks/file.js";
import { checkHttpStatus, checkHttpJsonField } from "./checks/http.js";
import { checkDomElementPresent, checkDomTextContains } from "./checks/dom.js";
import { checkDataMatchesPattern, checkDataFieldEquals } from "./checks/data.js";

export type CustomCheckHandler = (
  condition: PostCondition,
  context: CheckContext
) => Promise<ConditionCheckResult>;

export class PostConditionEngine {
  private log = createLogger({ component: "postcondition-engine" });
  private customHandlers: Map<string, CustomCheckHandler> = new Map();

  constructor() {
    this.log.debug("PostConditionEngine initialized with standard check suite");
  }

  /** Register a custom condition handler */
  registerCustomHandler(type: string, handler: CustomCheckHandler): void {
    this.customHandlers.set(type, handler);
    this.log.debug({ type }, "Custom post-condition handler registered");
  }

  /** Run a single post-condition check */
  async checkCondition(
    condition: PostCondition,
    context: CheckContext
  ): Promise<ConditionCheckResult> {
    const start = Date.now();
    try {
      switch (condition.type) {
        case "file_exists":
          return await checkFileExists(condition, context);
        case "file_size":
          return await checkFileSize(condition, context);
        case "file_hash":
          return await checkFileHash(condition, context);
        case "file_contains":
          return await checkFileContains(condition, context);
        case "http_status":
          return await checkHttpStatus(condition, context);
        case "http_json_field":
          return await checkHttpJsonField(condition, context);
        case "dom_element_present":
          return await checkDomElementPresent(condition, context);
        case "dom_text_contains":
          return await checkDomTextContains(condition, context);
        case "data_matches_pattern":
          return await checkDataMatchesPattern(condition, context);
        case "data_field_equals":
          return await checkDataFieldEquals(condition, context);
        case "custom": {
          const customName = String(condition.params.handler ?? condition.id);
          const handler = this.customHandlers.get(customName);
          if (!handler) {
            return {
              conditionId: condition.id,
              name: condition.name,
              type: condition.type,
              passed: false,
              score: 0.0,
              weight: condition.weight ?? 1.0,
              critical: condition.critical ?? false,
              message: `Unknown custom condition handler: '${customName}'`,
              durationMs: Date.now() - start,
            };
          }
          return await handler(condition, context);
        }
        default:
          return {
            conditionId: condition.id,
            name: condition.name,
            type: condition.type,
            passed: false,
            score: 0.0,
            weight: condition.weight ?? 1.0,
            critical: condition.critical ?? false,
            message: `Unsupported post-condition type: '${condition.type}'`,
            durationMs: Date.now() - start,
          };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error({ conditionId: condition.id, err: msg }, "Condition check threw unhandled error");
      return {
        conditionId: condition.id,
        name: condition.name,
        type: condition.type,
        passed: false,
        score: 0.0,
        weight: condition.weight ?? 1.0,
        critical: condition.critical ?? false,
        message: `Condition evaluation exception: ${msg}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /** Run a suite of post-conditions concurrently or sequentially */
  async evaluateAll(
    conditions: PostCondition[],
    context: CheckContext
  ): Promise<ConditionCheckResult[]> {
    this.log.info({ count: conditions.length, taskId: context.taskId }, "Evaluating post-conditions");
    const results: ConditionCheckResult[] = [];

    for (const condition of conditions) {
      const result = await this.checkCondition(condition, context);
      results.push(result);
      this.log.debug(
        {
          id: condition.id,
          passed: result.passed,
          score: result.score,
          critical: result.critical,
          message: result.message,
        },
        "Condition check finished"
      );
    }

    return results;
  }
}
