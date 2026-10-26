/**
 * @concurrent/audit
 *
 * Security, Permissions & Audit Layer:
 * - Immutable SHA-256 hash-chained audit trail
 * - Zero-leak credential vault with AES-256-GCM encryption
 * - Log redaction for tokens, PII, keys, and registered secrets
 * - Data classification and external LLM egress guard
 * - Network security policy (domain whitelist, port blocks, TLS enforcement)
 * - Permission enforcer with violation recording
 * - Unified SecurityGateway facade
 */

export const AUDIT_MODULE_VERSION = "0.1.0";

export * from "./types.js";
export * from "./redaction/redactor.js";
export * from "./credentials/vault.js";
export * from "./classification/classifier.js";
export * from "./network/security.js";
export * from "./audit/trail.js";
export * from "./permissions/enforcer.js";
export * from "./security.js";
