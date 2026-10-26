/**
 * Entity Graph
 *
 * Loads and manages the company entity graph — people, internal systems,
 * and their relationships. Provides NL entity resolution (e.g. "my manager"
 * → Person record) and fuzzy lookup by name/alias.
 *
 * The entity data is loaded from a YAML configuration file:
 *   config/entities.yaml
 *
 * Entity resolution is used by the planner's context expansion step to
 * replace references like "email John" → john.smith@company.com.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import { createLogger } from "@concurrent/core";
import type { EntityGraph, Person, InternalSystem, EntityRelationship } from "../types.js";

const log = createLogger({ component: "entity-graph" });

// ─────────────────────────────────────────────────────────────────────────────
// YAML LOADING
// ─────────────────────────────────────────────────────────────────────────────

async function loadYaml(filePath: string): Promise<unknown> {
  const { load } = await import("js-yaml");
  const raw = await fs.readFile(filePath, "utf-8");
  return load(raw);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSING
// ─────────────────────────────────────────────────────────────────────────────

function parsePerson(raw: Record<string, unknown>): Person {
  return {
    id: String(raw.id ?? raw.email ?? raw.name ?? "unknown"),
    name: String(raw.name ?? ""),
    email: String(raw.email ?? ""),
    role: String(raw.role ?? ""),
    department: String(raw.department ?? ""),
    team: raw.team !== undefined ? String(raw.team) : undefined,
    manager: raw.manager !== undefined ? String(raw.manager) : undefined,
    aliases: Array.isArray(raw.aliases)
      ? (raw.aliases as unknown[]).map(String)
      : [],
  };
}

function parseSystem(raw: Record<string, unknown>): InternalSystem {
  const validAuth = ["basic", "oauth", "saml", "api_key", "session", "none"] as const;
  type AuthMethod = (typeof validAuth)[number];
  const authMethod: AuthMethod = validAuth.includes(raw.authMethod as AuthMethod)
    ? (raw.authMethod as AuthMethod)
    : "none";

  return {
    id: String(raw.id ?? raw.name ?? "unknown"),
    name: String(raw.name ?? ""),
    url: raw.url !== undefined ? String(raw.url) : undefined,
    authMethod,
    owner: String(raw.owner ?? ""),
    description: String(raw.description ?? ""),
    aliases: Array.isArray(raw.aliases)
      ? (raw.aliases as unknown[]).map(String)
      : [],
  };
}

function parseRelationship(raw: Record<string, unknown>): EntityRelationship {
  const validTypes = [
    "manages",
    "approves_for",
    "owns_system",
    "member_of",
    "submits_to",
  ] as const;
  type RelType = (typeof validTypes)[number];
  const type: RelType = validTypes.includes(raw.type as RelType)
    ? (raw.type as RelType)
    : "member_of";

  return {
    from: String(raw.from ?? ""),
    to: String(raw.to ?? ""),
    type,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FUZZY MATCHING
// ─────────────────────────────────────────────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().trim();
}

function nameMatchScore(candidate: string, query: string): number {
  const c = normalize(candidate);
  const q = normalize(query);
  if (c === q) return 1.0;
  if (c.startsWith(q) || q.startsWith(c)) return 0.8;
  if (c.includes(q) || q.includes(c)) return 0.6;
  // Token intersection
  const ct = new Set(c.split(/\s+/));
  const qt = new Set(q.split(/\s+/));
  const intersection = [...ct].filter((t) => qt.has(t)).length;
  if (intersection > 0) return 0.3 + 0.1 * intersection;
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY GRAPH
// ─────────────────────────────────────────────────────────────────────────────

export interface EntityGraphOptions {
  /** Path to the entities YAML file */
  entitiesFilePath: string;
}

export class EntityGraphManager {
  private graph: EntityGraph = {
    people: [],
    systems: [],
    relationships: [],
    lastBuiltAt: new Date(0),
  };

  constructor(private opts: EntityGraphOptions) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Load entity graph from YAML file. */
  async load(): Promise<void> {
    if (!fsSync.existsSync(this.opts.entitiesFilePath)) {
      log.warn(
        { path: this.opts.entitiesFilePath },
        "Entities YAML not found — entity graph will be empty",
      );
      return;
    }

    try {
      const raw = await loadYaml(this.opts.entitiesFilePath) as Record<string, unknown>;

      const people = Array.isArray(raw.people)
        ? (raw.people as Record<string, unknown>[]).map(parsePerson)
        : [];

      const systems = Array.isArray(raw.systems)
        ? (raw.systems as Record<string, unknown>[]).map(parseSystem)
        : [];

      const relationships = Array.isArray(raw.relationships)
        ? (raw.relationships as Record<string, unknown>[]).map(parseRelationship)
        : [];

      this.graph = {
        people,
        systems,
        relationships,
        lastBuiltAt: new Date(),
      };

      log.info(
        { people: people.length, systems: systems.length, relationships: relationships.length },
        "Entity graph loaded",
      );
    } catch (err) {
      log.error({ err: String(err) }, "Failed to load entity graph");
    }
  }

  // ── Person Lookup ──────────────────────────────────────────────────────────

  /**
   * Find a person by name, email, alias, or role.
   *
   * @param query  Free-text query, e.g. "john", "finance manager", "john@co.com"
   * @param topK   Max results (default 3)
   */
  findPeople(query: string, topK = 3): Array<{ person: Person; score: number }> {
    const results = this.graph.people
      .map((person) => {
        const scores = [
          nameMatchScore(person.name, query),
          nameMatchScore(person.email, query),
          nameMatchScore(person.role, query),
          nameMatchScore(person.department, query),
          ...person.aliases.map((a) => nameMatchScore(a, query)),
        ];
        return { person, score: Math.max(...scores) };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return results;
  }

  /** Get a person by exact ID. */
  getPersonById(id: string): Person | undefined {
    return this.graph.people.find((p) => p.id === id);
  }

  /** Resolve a possessive pronoun in context (e.g. "my" → requestedBy person). */
  resolvePronouns(text: string, requestedBy: string): string {
    const person = this.getPersonById(requestedBy)
      ?? this.findPeople(requestedBy)[0]?.person;

    if (!person) return text;

    return text
      .replace(/\bmy\b/gi, person.name)
      .replace(/\bmine\b/gi, `${person.name}'s`)
      .replace(/\bI\b/g, person.name);
  }

  // ── System Lookup ──────────────────────────────────────────────────────────

  /**
   * Find an internal system by name, URL, or alias.
   *
   * @param query  Free-text query, e.g. "expense system", "jira"
   */
  findSystem(query: string, topK = 3): Array<{ system: InternalSystem; score: number }> {
    return this.graph.systems
      .map((system) => {
        const scores = [
          nameMatchScore(system.name, query),
          nameMatchScore(system.description, query),
          system.url ? nameMatchScore(system.url, query) : 0,
          ...system.aliases.map((a) => nameMatchScore(a, query)),
        ];
        return { system, score: Math.max(...scores) };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  /** Get a system by exact ID. */
  getSystemById(id: string): InternalSystem | undefined {
    return this.graph.systems.find((s) => s.id === id);
  }

  // ── Relationship Traversal ─────────────────────────────────────────────────

  /** Get all outgoing relationships from an entity. */
  getRelationships(
    entityId: string,
    type?: EntityRelationship["type"],
  ): EntityRelationship[] {
    return this.graph.relationships.filter(
      (r) => r.from === entityId && (!type || r.type === type),
    );
  }

  /** Get the manager of a person. */
  getManager(personId: string): Person | undefined {
    const rel = this.graph.relationships.find(
      (r) => r.from === personId && r.type === "manages",
    );
    return rel ? this.getPersonById(rel.to) : undefined;
  }

  // ── Summary for Planner Injection ─────────────────────────────────────────

  /**
   * Produce a compact text summary of the relevant entities for a request.
   * Injected into the planner system prompt as company context.
   */
  buildContextSummary(
    people: Person[],
    systems: InternalSystem[],
  ): string {
    const lines: string[] = [];

    if (people.length > 0) {
      lines.push("RELEVANT PEOPLE:");
      for (const p of people) {
        lines.push(`  - ${p.name} (${p.role}, ${p.department}) <${p.email}>`);
      }
    }

    if (systems.length > 0) {
      lines.push("RELEVANT SYSTEMS:");
      for (const s of systems) {
        lines.push(`  - ${s.name}${s.url ? ` → ${s.url}` : ""} [auth: ${s.authMethod}] — ${s.description}`);
      }
    }

    return lines.join("\n");
  }

  /** The full entity graph. */
  getGraph(): EntityGraph {
    return this.graph;
  }
}
