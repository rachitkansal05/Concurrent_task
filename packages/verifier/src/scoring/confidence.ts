/**
 * Confidence Scoring
 *
 * Calculates aggregate confidence scores from condition check results,
 * enforces critical condition gates, and assigns outcome status.
 */

import type {
  ConditionCheckResult,
  ConfidenceThresholds,
  VerificationStatus,
} from "../types.js";

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  passThreshold: 0.85,
  reviewThreshold: 0.6,
};

export interface ConfidenceEvaluation {
  status: VerificationStatus;
  overallConfidence: number;
  passedCount: number;
  failedCount: number;
  totalChecks: number;
  criticalFailure: boolean;
  summary: string;
}

export class ConfidenceScorer {
  constructor(private thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS) {}

  /** Evaluate aggregate confidence from individual condition results */
  evaluate(results: ConditionCheckResult[]): ConfidenceEvaluation {
    if (results.length === 0) {
      return {
        status: "passed",
        overallConfidence: 1.0,
        passedCount: 0,
        failedCount: 0,
        totalChecks: 0,
        criticalFailure: false,
        summary: "No verification conditions defined — default pass.",
      };
    }

    let totalWeight = 0;
    let weightedScoreSum = 0;
    let passedCount = 0;
    let failedCount = 0;
    let criticalFailure = false;
    const failedCriticalNames: string[] = [];

    for (const res of results) {
      const weight = typeof res.weight === "number" && res.weight > 0 ? res.weight : 1.0;
      totalWeight += weight;
      weightedScoreSum += res.score * weight;

      if (res.passed) {
        passedCount++;
      } else {
        failedCount++;
        if (res.critical) {
          criticalFailure = true;
          failedCriticalNames.push(res.name);
        }
      }
    }

    const overallConfidence = totalWeight > 0 ? weightedScoreSum / totalWeight : 0.0;

    // Determine status
    let status: VerificationStatus;
    let summary: string;

    if (criticalFailure) {
      status = "failed";
      summary = `Verification FAILED: Critical condition(s) failed: [${failedCriticalNames.join(", ")}]. Confidence score: ${(overallConfidence * 100).toFixed(1)}%.`;
    } else if (overallConfidence >= this.thresholds.passThreshold) {
      status = "passed";
      summary = `Verification PASSED: Confidence score ${(overallConfidence * 100).toFixed(1)}% exceeds required threshold ${(this.thresholds.passThreshold * 100).toFixed(0)}%. (${passedCount}/${results.length} checks passed).`;
    } else if (overallConfidence >= this.thresholds.reviewThreshold) {
      status = "needs_review";
      summary = `Verification NEEDS HUMAN REVIEW: Confidence score ${(overallConfidence * 100).toFixed(1)}% is in review band [${(this.thresholds.reviewThreshold * 100).toFixed(0)}% - ${(this.thresholds.passThreshold * 100).toFixed(0)}%].`;
    } else {
      status = "failed";
      summary = `Verification FAILED: Confidence score ${(overallConfidence * 100).toFixed(1)}% is below review threshold ${(this.thresholds.reviewThreshold * 100).toFixed(0)}%. (${failedCount}/${results.length} checks failed).`;
    }

    return {
      status,
      overallConfidence: Math.round(overallConfidence * 1000) / 1000,
      passedCount,
      failedCount,
      totalChecks: results.length,
      criticalFailure,
      summary,
    };
  }
}
