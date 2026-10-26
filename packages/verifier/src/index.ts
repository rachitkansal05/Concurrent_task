/**
 * @concurrent/verifier
 *
 * Outcome verification, post-condition checks, evidence collection,
 * and audit-ready evidence bundling.
 */

export const VERIFIER_MODULE_VERSION = "0.1.0";

// Core Types
export * from "./types.js";

// Post-condition Engine & Checks
export { PostConditionEngine } from "./postconditions/engine.js";
export {
  checkFileExists,
  checkFileHash,
  checkFileSize,
  checkFileContains,
} from "./postconditions/checks/file.js";
export {
  checkHttpStatus,
  checkHttpJsonField,
} from "./postconditions/checks/http.js";
export {
  checkDomElementPresent,
  checkDomTextContains,
} from "./postconditions/checks/dom.js";
export {
  checkDataMatchesPattern,
  checkDataFieldEquals,
} from "./postconditions/checks/data.js";

// LLM Verifier
export { LLMVerifier } from "./llm/llm-verifier.js";

// Evidence Collection & Bundling
export { EvidenceCollector } from "./evidence/collector.js";
export { EvidenceBundler, type BundlerOptions } from "./evidence/bundler.js";

// Confidence Scoring
export {
  ConfidenceScorer,
  DEFAULT_THRESHOLDS,
  type ConfidenceEvaluation,
} from "./scoring/confidence.js";

// Unified Verification Engine
export {
  VerificationEngine,
  type VerificationEngineOptions,
} from "./verifier.js";
