/**
 * LLM-based Outcome Verification
 *
 * Evaluates visual, subjective, or semantic task outcomes against criteria.
 */

import { createLogger } from "@concurrent/core";
import type {
  ConditionCheckResult,
  LLMVerificationSpec,
  VerifierLLMClient,
} from "../types.js";

export interface LLMEvaluationResponse {
  passed: boolean;
  score: number;
  reasoning: string;
  criteriaResults: Array<{ criterion: string; passed: boolean; note?: string }>;
}

export class LLMVerifier {
  private log = createLogger({ component: "llm-verifier" });

  constructor(private llmClient?: VerifierLLMClient) {}

  /** Evaluate a subjective or ambiguous outcome against acceptance criteria */
  async evaluate(spec: LLMVerificationSpec): Promise<ConditionCheckResult> {
    const start = Date.now();
    this.log.info({ conditionId: spec.conditionId, name: spec.name }, "Running LLM outcome verification");

    // If no LLM client configured, provide rule-based semantic fallback
    if (!this.llmClient) {
      return this.heuristicFallback(spec, start);
    }

    const systemPrompt = `You are an Autonomous Company Operator Outcome Verifier.
Your job is to strictly evaluate whether a completed task produced the expected business outcome based on criteria.
Respond ONLY with a valid JSON object matching this schema:
{
  "passed": boolean,
  "score": number, // between 0.0 and 1.0
  "reasoning": "concise explanation",
  "criteriaResults": [
    { "criterion": "criterion description", "passed": boolean, "note": "brief observation" }
  ]
}`;

    const userPrompt = `TASK OUTCOME VERIFICATION:
Condition Name: ${spec.name}
Instructions: ${spec.prompt}

ACCEPTANCE CRITERIA:
${spec.expectedCriteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

CONTEXT AND OUTPUT DATA:
${JSON.stringify(spec.contextData, null, 2)}

Evaluate whether the criteria are met based on the context data.`;

    try {
      const response = await this.llmClient.complete(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.0 }
      );

      const parsed = this.parseResponse(response.content);
      const passed = parsed.passed && parsed.score >= 0.7;

      return {
        conditionId: spec.conditionId,
        name: spec.name,
        type: "llm_evaluation",
        passed,
        score: Math.min(1.0, Math.max(0.0, parsed.score)),
        weight: spec.weight ?? 1.0,
        critical: spec.critical ?? false,
        message: parsed.reasoning,
        details: {
          criteriaResults: parsed.criteriaResults,
          rawScore: parsed.score,
        },
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.log.warn({ err: errMsg }, "LLM evaluation call failed — falling back to heuristic evaluation");
      return this.heuristicFallback(spec, start);
    }
  }

  private parseResponse(content: string): LLMEvaluationResponse {
    // Strip markdown code fences if present
    const clean = content
      .replace(/```(?:json)?\s*/g, "")
      .replace(/```\s*$/g, "")
      .trim();

    try {
      const parsed = JSON.parse(clean);
      return {
        passed: Boolean(parsed.passed),
        score: typeof parsed.score === "number" ? parsed.score : parsed.passed ? 1.0 : 0.0,
        reasoning: String(parsed.reasoning ?? "Outcome evaluation complete"),
        criteriaResults: Array.isArray(parsed.criteriaResults) ? parsed.criteriaResults : [],
      };
    } catch {
      // Fallback if not valid JSON
      const looksPositive =
        content.toLowerCase().includes("pass") ||
        content.toLowerCase().includes("success") ||
        content.toLowerCase().includes("verified");
      return {
        passed: looksPositive,
        score: looksPositive ? 0.9 : 0.2,
        reasoning: content.slice(0, 200),
        criteriaResults: [],
      };
    }
  }

  private heuristicFallback(spec: LLMVerificationSpec, start: number): ConditionCheckResult {
    // Basic heuristic: check if context data contains non-empty signals
    const dataStr = JSON.stringify(spec.contextData).toLowerCase();
    const passedCriteria: Array<{ criterion: string; passed: boolean }> = [];

    for (const criterion of spec.expectedCriteria) {
      // Check if keywords from criterion appear in the context
      const words = criterion
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, "")
        .split(/\s+/)
        .filter((w) => w.length > 3);

      const matchedWords = words.filter((w) => dataStr.includes(w));
      const passed = words.length === 0 || matchedWords.length / words.length >= 0.5;
      passedCriteria.push({ criterion, passed });
    }

    const passCount = passedCriteria.filter((c) => c.passed).length;
    const score = spec.expectedCriteria.length > 0 ? passCount / spec.expectedCriteria.length : 1.0;
    const passed = score >= 0.6;

    return {
      conditionId: spec.conditionId,
      name: spec.name,
      type: "llm_evaluation",
      passed,
      score,
      weight: spec.weight ?? 1.0,
      critical: spec.critical ?? false,
      message: `Heuristic evaluation: ${passCount}/${spec.expectedCriteria.length} criteria satisfied`,
      details: { criteriaResults: passedCriteria, heuristic: true },
      durationMs: Date.now() - start,
    };
  }
}
