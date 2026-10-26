/**
 * Context Engine
 *
 * The top-level coordinator for Phase 3. Wires together:
 *   - KnowledgeIndexer  (vector-search company docs)
 *   - ProcedureLibrary  (match YAML playbooks)
 *   - EntityGraphManager (people + systems lookup)
 *   - PermissionModel   (tool permission evaluation)
 *
 * Primary API: given a request string + requesting user ID,
 * return a TaskContext that the PlanGenerator injects into its prompt.
 *
 * Also exposes `buildPromptInjection(context)` which returns a
 * human-readable text block ready for LLM consumption.
 */

import { createLogger } from "@concurrent/core";
import { KnowledgeIndexer, type KnowledgeIndexerOptions } from "./knowledge/indexer.js";
import { ProcedureLibrary, type ProcedureLibraryOptions } from "./procedures/library.js";
import { EntityGraphManager, type EntityGraphOptions } from "./entities/graph.js";
import { PermissionModel, type PermissionModelOptions } from "./permissions/model.js";
import type { TaskContext, KnowledgeChunk, Person, InternalSystem } from "./types.js";

const log = createLogger({ component: "context-engine" });

// ─────────────────────────────────────────────────────────────────────────────
// OPTIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface ContextEngineOptions {
  knowledge: KnowledgeIndexerOptions;
  procedures: ProcedureLibraryOptions;
  entities: EntityGraphOptions;
  permissions?: PermissionModelOptions;

  /** Max knowledge chunks to include in context (default 5) */
  maxKnowledgeChunks?: number;
  /** Max procedures to include (default 2) */
  maxProcedures?: number;
  /** Max people to include (default 5) */
  maxPeople?: number;
  /** Max systems to include (default 3) */
  maxSystems?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export class ContextEngine {
  readonly knowledge: KnowledgeIndexer;
  readonly procedures: ProcedureLibrary;
  readonly entities: EntityGraphManager;
  readonly permissions: PermissionModel;

  private opts: Required<
    Pick<ContextEngineOptions, "maxKnowledgeChunks" | "maxProcedures" | "maxPeople" | "maxSystems">
  >;

  constructor(options: ContextEngineOptions) {
    this.knowledge = new KnowledgeIndexer(options.knowledge);
    this.procedures = new ProcedureLibrary(options.procedures);
    this.entities = new EntityGraphManager(options.entities);
    this.permissions = new PermissionModel(options.permissions ?? {});

    this.opts = {
      maxKnowledgeChunks: options.maxKnowledgeChunks ?? 5,
      maxProcedures: options.maxProcedures ?? 2,
      maxPeople: options.maxPeople ?? 5,
      maxSystems: options.maxSystems ?? 3,
    };
  }

  // ── Initialization ─────────────────────────────────────────────────────────

  /**
   * Initialize all sub-engines.
   * Call this once at startup before retrieving context.
   */
  async initialize(): Promise<void> {
    log.info("Initializing Context Engine...");

    await Promise.all([
      this.knowledge.load().then(() => this.knowledge.index()),
      this.procedures.load(),
      this.entities.load(),
      this.permissions.load(),
    ]);

    log.info(
      {
        knowledgeChunks: this.knowledge.size,
        procedures: this.procedures.count,
        people: this.entities.getGraph().people.length,
        systems: this.entities.getGraph().systems.length,
      },
      "Context Engine initialized",
    );
  }

  // ── Context Retrieval ──────────────────────────────────────────────────────

  /**
   * Retrieve full context for a task request.
   *
   * @param request      The natural-language request
   * @param requestedBy  User/entity ID who made the request (for pronoun resolution)
   */
  async retrieve(request: string, requestedBy = "user"): Promise<TaskContext> {
    log.info({ request: request.slice(0, 80), requestedBy }, "Retrieving task context");

    // Resolve pronouns (my → person's name) before searching
    const resolvedRequest = this.entities.resolvePronouns(request, requestedBy);

    // ── 1. Procedure matching ────────────────────────────────────────────────
    const procedureMatches = this.procedures.match(
      resolvedRequest,
      this.opts.maxProcedures,
    );

    // ── 2. Knowledge retrieval ───────────────────────────────────────────────
    const knowledgeResult = this.knowledge.query(
      resolvedRequest,
      this.opts.maxKnowledgeChunks,
    );

    // ── 3. Entity extraction ─────────────────────────────────────────────────
    // Extract keywords from the request and match to people and systems
    const words = resolvedRequest
      .replace(/[^a-zA-Z0-9\s@.]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3);

    const peopleSet = new Map<string, Person>();
    const systemsSet = new Map<string, InternalSystem>();

    // Always include the requesting user if found
    const requester = this.entities.findPeople(requestedBy)[0];
    if (requester) {
      peopleSet.set(requester.person.id, requester.person);
    }

    // Search each word / bigram against people and systems
    const phrases = [resolvedRequest, ...words];
    for (const phrase of phrases) {
      for (const { person } of this.entities.findPeople(phrase, 2)) {
        if (peopleSet.size >= this.opts.maxPeople) break;
        peopleSet.set(person.id, person);
      }
      for (const { system } of this.entities.findSystem(phrase, 2)) {
        if (systemsSet.size >= this.opts.maxSystems) break;
        systemsSet.set(system.id, system);
      }
    }

    // Also pull in systems referenced by matched procedures
    for (const { procedure } of procedureMatches) {
      for (const sysRef of procedure.systems) {
        if (systemsSet.size >= this.opts.maxSystems) break;
        const found = this.entities.findSystem(sysRef, 1)[0];
        if (found) systemsSet.set(found.system.id, found.system);
      }
    }

    const people = Array.from(peopleSet.values());
    const systems = Array.from(systemsSet.values());

    // ── 4. Build summary ─────────────────────────────────────────────────────
    const summary = this.buildPromptInjection({
      request: resolvedRequest,
      procedures: procedureMatches,
      knowledge: knowledgeResult.chunks,
      entities: { people, systems },
      summary: "", // filled below
      retrievedAt: new Date(),
    });

    const context: TaskContext = {
      request: resolvedRequest,
      procedures: procedureMatches,
      knowledge: knowledgeResult.chunks,
      entities: { people, systems },
      summary,
      retrievedAt: new Date(),
    };

    log.info(
      {
        procedures: procedureMatches.length,
        knowledgeChunks: knowledgeResult.chunks.length,
        people: people.length,
        systems: systems.length,
      },
      "Context retrieved",
    );

    return context;
  }

  // ── Prompt Injection ───────────────────────────────────────────────────────

  /**
   * Build the plain-text context block injected into the planner's LLM prompt.
   *
   * Example output:
   *   --- COMPANY CONTEXT ---
   *   MATCHED PROCEDURE: Submit Expense Report (confidence: 87%)
   *     Step 1: browser.navigate → https://expenses.internal.com
   *     ...
   *   RELEVANT PEOPLE:
   *     - Alice Smith (CFO, Finance) <alice@co.com>
   *   RELEVANT SYSTEMS:
   *     - Expense Portal → https://expenses.internal.com [auth: oauth]
   *   RELEVANT KNOWLEDGE:
   *     [1] "The expense submission deadline is the 5th of each month..."
   *   -----------------------
   */
  buildPromptInjection(context: TaskContext): string {
    const lines: string[] = ["--- COMPANY CONTEXT ---"];

    // Procedures
    if (context.procedures.length > 0) {
      for (const { procedure, confidence } of context.procedures) {
        lines.push(
          `\nMATCHED PROCEDURE: ${procedure.name} (confidence: ${Math.round(confidence * 100)}%)`,
        );
        lines.push(`  Description: ${procedure.description}`);
        lines.push(`  Steps:`);
        for (const step of procedure.steps) {
          const paramsStr = Object.entries(step.params)
            .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
            .join(", ");
          lines.push(`    ${step.id}. [${step.tool}] ${step.description} (${paramsStr})`);
        }
        if (procedure.verification && procedure.verification.length > 0) {
          lines.push(`  Verification:`);
          for (const v of procedure.verification) {
            lines.push(`    - ${v.check}`);
          }
        }
      }
    } else {
      lines.push("\nNo matching company procedures found — use standard approach.");
    }

    // Entities
    const entitySummary = this.entities.buildContextSummary(
      context.entities.people,
      context.entities.systems,
    );
    if (entitySummary) {
      lines.push(`\n${entitySummary}`);
    }

    // Knowledge
    if (context.knowledge.length > 0) {
      lines.push("\nRELEVANT KNOWLEDGE:");
      context.knowledge.forEach((chunk: KnowledgeChunk, i: number) => {
        const preview = chunk.text.slice(0, 200).replace(/\n/g, " ");
        lines.push(`  [${i + 1}] "${preview}${chunk.text.length > 200 ? "..." : ""}"`);
        lines.push(`       Source: ${chunk.source.name}`);
      });
    }

    lines.push("-----------------------");
    return lines.join("\n");
  }

  // ── Convenience re-exports ─────────────────────────────────────────────────

  /** Re-index the knowledge base (e.g., after new docs are added). */
  async reindex(): Promise<void> {
    await this.knowledge.index();
  }

  /** Reload procedures (e.g., after editing YAML files). */
  async reloadProcedures(): Promise<void> {
    await this.procedures.load();
  }
}
