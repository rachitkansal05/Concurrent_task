/**
 * Task Classifier & Context Expander
 *
 * Expands implicit requirements in user requests and assesses
 * task type and risk level before planning.
 */

import type { LLMClient } from "../llm/types.js";
import type { ClassificationResult } from "./types.js";
import { createLogger } from "@concurrent/core";

const log = createLogger({ component: "task-classifier" });

const CLASSIFICATION_SYSTEM_PROMPT = `You are the Task Understanding & Classification engine of Concurrent, an Autonomous Company Operator.

Analyze the user's natural language request. Real company requests leave procedures, systems, and steps unstated.
Your goal is to:
1. Expand the unstated context (which internal systems, documents, dates, or communication channels are implied).
2. Classify the task type into one of:
   - "data_retrieval"       (fetching information, searching dashboards)
   - "form_filling"         (entering data into web or desktop forms)
   - "document_generation"  (creating reports, spreadsheets, PDFs)
   - "communication"        (sending emails, messaging team channels)
   - "approval_workflow"    (submitting or signing off on requests)
   - "monitoring"           (watching feeds, metrics, alerts)
   - "file_operation"       (copying, moving, converting files)
   - "composite"            (combination of multiple types above)
   - "unknown"
3. Assess the Risk Level:
   - "low"      (read-only operations, local scratch files, internal search)
   - "medium"   (generating internal reports, internal communications, filing non-binding forms)
   - "high"     (external emails, modifying existing production data, public actions)
   - "critical" (financial transactions, deleting databases, credential/permission updates)

Respond ONLY with valid JSON in this schema:
{
  "expandedRequest": string,
  "taskType": string,
  "riskLevel": string,
  "reasoning": string,
  "inferredEntities": {
    "systems": string[],
    "departments": string[],
    "recipients": string[],
    "deliverables": string[]
  }
}`;

export class TaskClassifier {
  constructor(private llm: LLMClient) {}

  /**
   * Fast rule-based heuristics to classify or act as offline fallback.
   */
  classifyHeuristic(rawRequest: string): ClassificationResult {
    const lower = rawRequest.toLowerCase();

    // Risk level estimation
    let riskLevel: ClassificationResult["riskLevel"] = "medium";
    if (
      lower.includes("delete") ||
      lower.includes("transfer") ||
      lower.includes("wire") ||
      lower.includes("production db") ||
      lower.includes("password") ||
      lower.includes("salary")
    ) {
      riskLevel = "critical";
    } else if (
      lower.includes("external") ||
      lower.includes("client") ||
      lower.includes("customer") ||
      lower.includes("contract")
    ) {
      riskLevel = "high";
    } else if (
      lower.includes("read") ||
      lower.includes("search") ||
      lower.includes("check") ||
      lower.includes("list") ||
      lower.includes("fetch")
    ) {
      riskLevel = "low";
    }

    // Task type estimation
    let taskType: ClassificationResult["taskType"] = "composite";
    if (lower.includes("email") || lower.includes("slack") || lower.includes("notify")) {
      taskType = lower.includes("generate") || lower.includes("report") ? "composite" : "communication";
    } else if (lower.includes("report") || lower.includes("excel") || lower.includes("pdf")) {
      taskType = "document_generation";
    } else if (lower.includes("fill") || lower.includes("submit form")) {
      taskType = "form_filling";
    } else if (lower.includes("get") || lower.includes("find") || lower.includes("fetch")) {
      taskType = "data_retrieval";
    }

    return {
      expandedRequest: `Execute procedure to fulfill: "${rawRequest}". Identify required systems and produce required deliverables.`,
      taskType,
      riskLevel,
      reasoning: `Rule-based heuristic evaluation based on keywords in request.`,
      inferredEntities: {},
    };
  }

  /**
   * Classify request using LLM, with fallback to heuristic rules.
   */
  async classify(rawRequest: string): Promise<ClassificationResult> {
    try {
      log.debug({ request: rawRequest }, "Classifying user request with LLM");

      const result = await this.llm.generateJSON<ClassificationResult>(
        `User Request: "${rawRequest}"`,
        {
          systemPrompt: CLASSIFICATION_SYSTEM_PROMPT,
        },
      );

      // Validate enum fields
      const validTypes = [
        "data_retrieval",
        "form_filling",
        "document_generation",
        "communication",
        "approval_workflow",
        "monitoring",
        "file_operation",
        "composite",
        "unknown",
      ];
      const validRisks = ["low", "medium", "high", "critical"];

      const taskType = validTypes.includes(result.taskType) ? result.taskType : "composite";
      const riskLevel = validRisks.includes(result.riskLevel) ? result.riskLevel : "medium";

      return {
        expandedRequest: result.expandedRequest || rawRequest,
        taskType: taskType as ClassificationResult["taskType"],
        riskLevel: riskLevel as ClassificationResult["riskLevel"],
        reasoning: result.reasoning || "Context expanded based on task requirements.",
        inferredEntities: result.inferredEntities || {},
      };
    } catch (err) {
      log.warn(
        { err: String(err), request: rawRequest },
        "LLM classification failed, falling back to rule-based heuristics",
      );
      return this.classifyHeuristic(rawRequest);
    }
  }
}
