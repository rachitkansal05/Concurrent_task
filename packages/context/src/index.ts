/**
 * @concurrent/context — Company Context Engine
 *
 * Public API:
 *   - ContextEngine        — top-level coordinator (initialize + retrieve)
 *   - KnowledgeIndexer     — document chunking + vector search
 *   - ProcedureLibrary     — YAML playbook loading + trigger matching
 *   - EntityGraphManager   — people + system lookup + pronoun resolution
 *   - PermissionModel      — risk-tiered permission evaluation
 *
 * Quick start:
 *   const engine = new ContextEngine({ ... });
 *   await engine.initialize();
 *   const ctx = await engine.retrieve("submit my expenses");
 *   // ctx.summary → inject into planner prompt
 *   // ctx.procedures → matched playbooks
 *   // ctx.entities → resolved people & systems
 */

// Main engine
export { ContextEngine } from "./engine.js";
export type { ContextEngineOptions } from "./engine.js";

// Sub-modules (direct use)
export { KnowledgeIndexer } from "./knowledge/indexer.js";
export type { KnowledgeIndexerOptions } from "./knowledge/indexer.js";

export { ProcedureLibrary } from "./procedures/library.js";
export type { ProcedureLibraryOptions } from "./procedures/library.js";

export { EntityGraphManager } from "./entities/graph.js";
export type { EntityGraphOptions } from "./entities/graph.js";

export { PermissionModel } from "./permissions/model.js";
export type { PermissionModelOptions } from "./permissions/model.js";

// Types
export type {
  // Knowledge
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeQueryResult,
  // Procedures
  Procedure,
  ProcedureStep,
  ProcedureVerification,
  ProcedureMatch,
  // Entities
  Person,
  InternalSystem,
  EntityGraph,
  EntityRelationship,
  // Permissions
  PermissionPolicy,
  ToolPermission,
  PermissionCheckResult,
  // Context
  TaskContext,
} from "./types.js";
