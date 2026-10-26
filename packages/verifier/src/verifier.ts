/**
 * Unified Verification Engine
 *
 * Coordinates post-condition execution, LLM-based outcome verification,
 * evidence collection and bundling, and confidence scoring.
 */

import { createLogger } from "@concurrent/core";
import type { Task } from "@concurrent/core";
import type {
  CheckContext,
  ConditionCheckResult,
  ConfidenceThresholds,
  LLMVerificationSpec,
  PostCondition,
  TaskVerificationReport,
  VerifierLLMClient,
} from "./types.js";
import { PostConditionEngine } from "./postconditions/engine.js";
import { LLMVerifier } from "./llm/llm-verifier.js";
import { EvidenceCollector } from "./evidence/collector.js";
import { EvidenceBundler, BundlerOptions } from "./evidence/bundler.js";
import { ConfidenceScorer, DEFAULT_THRESHOLDS } from "./scoring/confidence.js";

export interface VerificationEngineOptions {
  thresholds?: ConfidenceThresholds;
  bundlerOptions?: BundlerOptions;
  llmClient?: VerifierLLMClient;
}

export class VerificationEngine {
  private log = createLogger({ component: "verification-engine" });
  readonly postConditions: PostConditionEngine;
  readonly llmVerifier: LLMVerifier;
  readonly bundler: EvidenceBundler;
  readonly scorer: ConfidenceScorer;

  constructor(private options: VerificationEngineOptions = {}) {
    this.postConditions = new PostConditionEngine();
    this.llmVerifier = new LLMVerifier(options.llmClient);
    this.bundler = new EvidenceBundler(options.bundlerOptions);
    this.scorer = new ConfidenceScorer(options.thresholds ?? DEFAULT_THRESHOLDS);
    this.log.debug("VerificationEngine initialized");
  }

  /**
   * Run verification on a completed task.
   *
   * @param task The task that was executed
   * @param options Execution context, step outputs, and verification conditions
   */
  async verifyTask(
    task: Task,
    options: {
      postConditions?: PostCondition[];
      llmSpecs?: LLMVerificationSpec[];
      stepOutputs?: Record<number, Record<string, unknown>>;
      workingDir?: string;
      customData?: Record<string, unknown>;
    } = {}
  ): Promise<TaskVerificationReport> {
    const start = Date.now();
    this.log.info({ taskId: task.id, request: task.request }, "Starting task verification");

    // 1. Initialize evidence collector and ingest task evidence
    const collector = new EvidenceCollector(task.id);
    if (task.evidence && task.evidence.length > 0) {
      await collector.ingestCoreEvidence(task.evidence);
    }

    const checkContext: CheckContext = {
      taskId: task.id,
      workingDir: options.workingDir ?? process.cwd(),
      stepOutputs: options.stepOutputs,
      evidenceList: collector.getItems(),
      customData: options.customData,
    };

    // 2. Evaluate programmatic post-conditions
    const conditionResults: ConditionCheckResult[] = [];
    if (options.postConditions && options.postConditions.length > 0) {
      const pcResults = await this.postConditions.evaluateAll(
        options.postConditions,
        checkContext
      );
      conditionResults.push(...pcResults);
    }

    // 3. Evaluate LLM semantic verification specifications
    if (options.llmSpecs && options.llmSpecs.length > 0) {
      for (const spec of options.llmSpecs) {
        const llmResult = await this.llmVerifier.evaluate(spec);
        conditionResults.push(llmResult);
      }
    }

    // 4. Calculate confidence scoring and outcome status
    const evaluation = this.scorer.evaluate(conditionResults);

    // 5. Bundle evidence and generate manifest & audit report
    const bundle = await this.bundler.bundle(
      task.id,
      collector.getItems(),
      conditionResults
    );

    const report: TaskVerificationReport = {
      taskId: task.id,
      status: evaluation.status,
      overallConfidence: evaluation.overallConfidence,
      passedCount: evaluation.passedCount,
      failedCount: evaluation.failedCount,
      totalChecks: evaluation.totalChecks,
      criticalFailure: evaluation.criticalFailure,
      results: conditionResults,
      evidenceBundle: bundle,
      verifiedAt: new Date().toISOString(),
      summary: evaluation.summary,
    };

    this.log.info(
      {
        taskId: task.id,
        status: report.status,
        confidence: report.overallConfidence,
        checks: `${report.passedCount}/${report.totalChecks}`,
        durationMs: Date.now() - start,
      },
      "Task verification complete"
    );

    return report;
  }
}
