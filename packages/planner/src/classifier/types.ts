import type { TaskType, RiskLevel } from "@concurrent/core";

export interface ClassificationResult {
  /** The natural language request expanded with implicit context */
  expandedRequest: string;

  /** Identified category of task */
  taskType: TaskType;

  /** Assessed risk level */
  riskLevel: RiskLevel;

  /** Explanation of why this risk level and type were assigned */
  reasoning: string;

  /** Extracted entities and implied targets */
  inferredEntities: {
    systems?: string[];
    departments?: string[];
    recipients?: string[];
    deliverables?: string[];
  };
}
