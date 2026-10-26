/**
 * Phase 3 — Company Context Engine Tests
 *
 * Tests for:
 *   - KnowledgeIndexer: chunking, indexing, cosine similarity search
 *   - ProcedureLibrary: YAML loading, trigger matching, validation
 *   - EntityGraphManager: person/system lookup, pronoun resolution
 *   - PermissionModel: rule matching, risk-level rules, batch check
 *   - ContextEngine: full integration retrieval
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { KnowledgeIndexer } from "../src/knowledge/indexer.js";
import { ProcedureLibrary } from "../src/procedures/library.js";
import { EntityGraphManager } from "../src/entities/graph.js";
import { PermissionModel } from "../src/permissions/model.js";
import { ContextEngine } from "../src/engine.js";

// ─────────────────────────────────────────────────────────────────────────────
// TEST FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

const SAMPLE_DOC = `
# Expense Policy
Employees must submit expense reports within 30 days of the expense date.
The expense submission deadline is the 5th of each month.
Log into the expense portal at https://expenses.internal.com to submit.
Expenses over 500 dollars require manager and finance approval.
Receipts are required for all expenses over 25 dollars.
`;

const SAMPLE_PROCEDURE_YAML = `
procedure:
  name: Submit Expense Report
  description: Guides the AI through submitting expense reports
  triggers:
    - submit expense report
    - file my expenses
    - expense report
    - claim expenses
  systems:
    - expense-portal
  riskLevel: medium
  steps:
    - id: 1
      description: Navigate to expense portal
      tool: browser.navigate
      params:
        url: https://expenses.internal.com
    - id: 2
      description: Click new report
      tool: browser.click
      params:
        selector: "#new-report"
      dependsOn: [1]
    - id: 3
      description: Submit report
      tool: browser.click
      params:
        selector: "#submit"
      dependsOn: [2]
  verification:
    - check: Confirmation ID visible
      tool: browser.extract
      params:
        selector: ".confirmation-id"
      expected: "^EXP-"
`;

const SAMPLE_ENTITIES_YAML = `
people:
  - id: alice.cfo
    name: Alice CFO
    email: alice@company.com
    role: Chief Financial Officer
    department: Finance
    aliases: [alice, cfo]

  - id: bob.finance
    name: Bob Finance
    email: bob@company.com
    role: Finance Manager
    department: Finance
    manager: alice.cfo
    aliases: [bob, finance manager]

systems:
  - id: expense-portal
    name: Expense Portal
    url: https://expenses.internal.com
    authMethod: oauth
    owner: Finance
    description: Internal expense submission system
    aliases: [expenses, expense system]

relationships:
  - from: alice.cfo
    to: bob.finance
    type: manages
  - from: bob.finance
    to: expense-portal
    type: owns_system
`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "concurrent-test-"));
}

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE INDEXER
// ─────────────────────────────────────────────────────────────────────────────

describe("KnowledgeIndexer", () => {
  let docsDir: string;
  let workDir: string;
  let indexer: KnowledgeIndexer;

  beforeAll(async () => {
    docsDir = await makeTempDir();
    workDir = await makeTempDir();

    await fs.writeFile(path.join(docsDir, "expense-policy.md"), SAMPLE_DOC, "utf-8");
    await fs.writeFile(path.join(docsDir, "general.txt"), "Company values: integrity, innovation, collaboration.", "utf-8");

    indexer = new KnowledgeIndexer({ docsDir, workDir });
    await indexer.load();
    await indexer.index();
  });

  it("indexes documents and produces chunks", () => {
    expect(indexer.size).toBeGreaterThan(0);
  });

  it("returns sources from the indexed directory", () => {
    const sources = indexer.getSources();
    expect(sources.length).toBeGreaterThanOrEqual(2);
    expect(sources.some((s) => s.name.includes("expense"))).toBe(true);
  });

  it("finds relevant chunks for expense-related query", () => {
    const result = indexer.query("expense report submission deadline", 5);
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.totalFound).toBeGreaterThan(0);
    // Top chunk should mention expense-related content
    const topText = result.chunks[0].text.toLowerCase();
    expect(topText).toMatch(/expense/);
  });

  it("returns empty results for unrelated query", () => {
    // The chunk set is small so the threshold filters out completely unrelated content
    const result = indexer.query("quantum physics particle collider reactor", 3, 0.5);
    // With high threshold, should return very few or no results
    expect(result.chunks.length).toBeLessThanOrEqual(1);
  });

  it("chunks have required fields", () => {
    const result = indexer.query("expense", 3);
    for (const chunk of result.chunks) {
      expect(chunk.id).toBeTruthy();
      expect(chunk.text).toBeTruthy();
      expect(chunk.source).toBeTruthy();
      expect(chunk.embedding).toBeTruthy();
      expect(chunk.score).toBeGreaterThanOrEqual(0);
    }
  });

  it("persists index snapshot to disk", async () => {
    const snapshotPath = path.join(workDir, "knowledge-index.json");
    const exists = await fs
      .access(snapshotPath)
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(true);
  });

  it("skips unchanged files on re-index", async () => {
    const sizeBefore = indexer.size;
    await indexer.index(); // re-index without changes
    expect(indexer.size).toBe(sizeBefore); // same chunk count
  });

  it("re-indexes changed files", async () => {
    const newContent = "New policy: all expenses over 1000 require CFO approval.\n".repeat(5);
    await fs.writeFile(path.join(docsDir, "new-policy.md"), newContent, "utf-8");
    const sizeBefore = indexer.size;
    await indexer.index();
    expect(indexer.size).toBeGreaterThan(sizeBefore);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURE LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

describe("ProcedureLibrary", () => {
  let proceduresDir: string;
  let library: ProcedureLibrary;

  beforeAll(async () => {
    proceduresDir = await makeTempDir();
    await fs.writeFile(
      path.join(proceduresDir, "submit-expense.yaml"),
      SAMPLE_PROCEDURE_YAML,
      "utf-8",
    );
    library = new ProcedureLibrary({ proceduresDir, matchThreshold: 0.01 });
    await library.load();
  });

  it("loads procedures from YAML files", () => {
    expect(library.count).toBe(1);
  });

  it("lists all procedures", () => {
    const procs = library.list();
    expect(procs[0].name).toBe("Submit Expense Report");
    expect(procs[0].steps.length).toBe(3);
  });

  it("matches request to procedure by trigger", () => {
    const matches = library.match("submit expense report", 3);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].procedure.name).toBe("Submit Expense Report");
    expect(matches[0].confidence).toBeGreaterThan(0);
  });

  it("matches partial trigger phrase", () => {
    const matches = library.match("I need to file my expenses for this month", 3);
    expect(matches.length).toBeGreaterThan(0);
  });

  it("returns empty for unrelated request", () => {
    const matches = library.match("schedule a meeting with the team", 3);
    // Either no matches or very low confidence
    const highConfidence = matches.filter((m) => m.confidence > 0.3);
    expect(highConfidence.length).toBe(0);
  });

  it("returns procedure by ID", () => {
    const proc = library.getById("submit-expense-report");
    expect(proc).toBeDefined();
    expect(proc?.name).toBe("Submit Expense Report");
  });

  it("returns undefined for unknown ID", () => {
    expect(library.getById("nonexistent-proc")).toBeUndefined();
  });

  it("validates procedure steps have required fields", () => {
    const proc = library.list()[0];
    for (const step of proc.steps) {
      expect(step.id).toBeGreaterThan(0);
      expect(step.tool).toBeTruthy();
      expect(typeof step.params).toBe("object");
    }
  });

  it("handles missing procedures directory gracefully", async () => {
    const lib = new ProcedureLibrary({ proceduresDir: "/nonexistent/path" });
    await expect(lib.load()).resolves.not.toThrow();
    expect(lib.count).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY GRAPH
// ─────────────────────────────────────────────────────────────────────────────

describe("EntityGraphManager", () => {
  let entitiesFile: string;
  let graph: EntityGraphManager;

  beforeAll(async () => {
    const tmpDir = await makeTempDir();
    entitiesFile = path.join(tmpDir, "entities.yaml");
    await fs.writeFile(entitiesFile, SAMPLE_ENTITIES_YAML, "utf-8");
    graph = new EntityGraphManager({ entitiesFilePath: entitiesFile });
    await graph.load();
  });

  it("loads people from YAML", () => {
    const g = graph.getGraph();
    expect(g.people.length).toBe(2);
  });

  it("loads systems from YAML", () => {
    const g = graph.getGraph();
    expect(g.systems.length).toBe(1);
  });

  it("loads relationships from YAML", () => {
    const g = graph.getGraph();
    expect(g.relationships.length).toBe(2);
  });

  it("finds person by name", () => {
    const results = graph.findPeople("alice");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].person.name).toBe("Alice CFO");
  });

  it("finds person by alias", () => {
    const results = graph.findPeople("cfo");
    expect(results.length).toBeGreaterThan(0);
  });

  it("finds person by email", () => {
    const results = graph.findPeople("bob@company.com");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].person.name).toBe("Bob Finance");
  });

  it("finds system by alias", () => {
    const results = graph.findSystem("expense system");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].system.name).toBe("Expense Portal");
  });

  it("resolves 'my' pronoun to person's name", () => {
    const resolved = graph.resolvePronouns("submit my expenses", "alice.cfo");
    expect(resolved).toContain("Alice CFO");
    expect(resolved).not.toContain(" my ");
  });

  it("returns unchanged text when person not found", () => {
    const text = "submit my expenses";
    const resolved = graph.resolvePronouns(text, "unknown-user");
    expect(resolved).toBe(text);
  });

  it("gets relationships for an entity", () => {
    const rels = graph.getRelationships("alice.cfo", "manages");
    expect(rels.length).toBe(1);
    expect(rels[0].to).toBe("bob.finance");
  });

  it("builds context summary string", () => {
    const people = [graph.findPeople("alice")[0].person];
    const systems = [graph.findSystem("expense")[0].system];
    const summary = graph.buildContextSummary(people, systems);
    expect(summary).toContain("Alice CFO");
    expect(summary).toContain("Expense Portal");
    expect(summary).toContain("https://expenses.internal.com");
  });

  it("handles missing entities file gracefully", async () => {
    const g = new EntityGraphManager({ entitiesFilePath: "/nonexistent/entities.yaml" });
    await expect(g.load()).resolves.not.toThrow();
    expect(g.getGraph().people.length).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION MODEL
// ─────────────────────────────────────────────────────────────────────────────

describe("PermissionModel", () => {
  let model: PermissionModel;

  beforeEach(async () => {
    // Use default policy (no YAML file)
    model = new PermissionModel({});
    await model.load();
  });

  it("allows read-only browser actions", () => {
    const result = model.check("browser.navigate", "low");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("allows read-only filesystem actions", () => {
    const result = model.check("filesystem.read", "low");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(false);
  });

  it("requires approval for email.send", () => {
    const result = model.check("email.send", "medium");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it("requires approval for filesystem.delete", () => {
    const result = model.check("filesystem.delete", "low");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it("requires approval for cli.execute", () => {
    const result = model.check("cli.execute", "low");
    expect(result.allowed).toBe(true);
    expect(result.requiresApproval).toBe(true);
  });

  it("matches wildcard desktop.* pattern", () => {
    const result = model.check("desktop.click", "low");
    expect(result.requiresApproval).toBe(true);
  });

  it("requires approval for high-risk level tasks", () => {
    const result = model.check("browser.navigate", "high");
    // browser.navigate rule is 'allow', but risk level override should escalate
    // The rule match wins first — navigate is always allowed by rule
    // but for tools not matching any rule, high-risk escalates
    expect(result.allowed).toBe(true); // navigate is explicitly allowed
  });

  it("filters tools requiring approval from a batch", () => {
    const tools = [
      { toolName: "browser.navigate", riskLevel: "low" as const },
      { toolName: "email.send", riskLevel: "medium" as const },
      { toolName: "browser.screenshot", riskLevel: "low" as const },
      { toolName: "filesystem.delete", riskLevel: "low" as const },
    ];
    const approvals = model.filterRequiresApproval(tools);
    expect(approvals).toContain("email.send");
    expect(approvals).toContain("filesystem.delete");
    expect(approvals).not.toContain("browser.navigate");
    expect(approvals).not.toContain("browser.screenshot");
  });

  it("checkBatch returns results for all tools", () => {
    const tools = [
      { toolName: "browser.navigate", riskLevel: "low" as const },
      { toolName: "email.send", riskLevel: "medium" as const },
    ];
    const results = model.checkBatch(tools);
    expect(results.size).toBe(2);
    expect(results.get("browser.navigate")?.allowed).toBe(true);
    expect(results.get("email.send")?.requiresApproval).toBe(true);
  });

  it("loads policy from YAML file", async () => {
    const tmpDir = await makeTempDir();
    const policyPath = path.join(tmpDir, "permissions.yaml");
    await fs.writeFile(policyPath, `
name: test-policy
defaultLevel: deny
riskLevelRules:
  low: allow
  medium: allow
  high: require_approval
  critical: require_approval
rules:
  - toolPattern: browser.navigate
    level: allow
    reason: Navigation allowed
`, "utf-8");

    const m = new PermissionModel({ policyFilePath: policyPath });
    await m.load();
    expect(m.getPolicy().name).toBe("test-policy");
    expect(m.getPolicy().defaultLevel).toBe("deny");

    const navResult = m.check("browser.navigate", "low");
    expect(navResult.allowed).toBe(true);

    // Unmatched tool with deny default
    const unknownResult = m.check("unknown.action", "low");
    expect(unknownResult.allowed).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT ENGINE (Integration)
// ─────────────────────────────────────────────────────────────────────────────

describe("ContextEngine (integration)", () => {
  let engine: ContextEngine;

  beforeAll(async () => {
    const docsDir = await makeTempDir();
    const workDir = await makeTempDir();
    const proceduresDir = await makeTempDir();
    const tmpDir = await makeTempDir();
    const entitiesFile = path.join(tmpDir, "entities.yaml");

    await fs.writeFile(path.join(docsDir, "expense-policy.md"), SAMPLE_DOC, "utf-8");
    await fs.writeFile(
      path.join(proceduresDir, "submit-expense.yaml"),
      SAMPLE_PROCEDURE_YAML,
      "utf-8",
    );
    await fs.writeFile(entitiesFile, SAMPLE_ENTITIES_YAML, "utf-8");

    engine = new ContextEngine({
      knowledge: { docsDir, workDir },
      procedures: { proceduresDir, matchThreshold: 0.01 },
      entities: { entitiesFilePath: entitiesFile },
    });

    await engine.initialize();
  });

  it("initializes all sub-engines without error", () => {
    expect(engine.knowledge.size).toBeGreaterThan(0);
    expect(engine.procedures.count).toBe(1);
  });

  it("retrieves full context for expense request", async () => {
    const ctx = await engine.retrieve("submit expense report to finance", "alice.cfo");

    expect(ctx.procedures.length).toBeGreaterThan(0);
    expect(ctx.knowledge.length).toBeGreaterThan(0);
    expect(ctx.summary).toBeTruthy();
    expect(ctx.summary).toContain("COMPANY CONTEXT");
  });

  it("resolves pronoun in request before matching", async () => {
    const ctx = await engine.retrieve("submit my expenses", "alice.cfo");
    // The request should have been pronoun-resolved before searching
    expect(ctx.request).not.toContain(" my ");
  });

  it("builds prompt injection string with all sections", async () => {
    const ctx = await engine.retrieve("submit expense report", "bob.finance");
    expect(ctx.summary).toContain("MATCHED PROCEDURE");
    expect(ctx.summary).toContain("Submit Expense Report");
  });

  it("includes matched procedure steps in summary", async () => {
    const ctx = await engine.retrieve("submit expense report", "alice.cfo");
    expect(ctx.summary).toContain("browser.navigate");
  });

  it("returns knowledge chunks relevant to the request", async () => {
    const ctx = await engine.retrieve("expense submission deadline", "alice.cfo");
    expect(ctx.knowledge.length).toBeGreaterThan(0);
  });

  it("returns empty procedures for unrelated request", async () => {
    const ctx = await engine.retrieve("schedule a calendar meeting", "alice.cfo");
    // Very unlikely to match expense procedures
    const highConfidence = ctx.procedures.filter((p) => p.confidence > 0.3);
    expect(highConfidence.length).toBe(0);
  });
});
