/**
 * Context Engine Types
 *
 * Type definitions for the Company Context Engine — covering knowledge
 * chunks, procedures, entities, and permissions.
 */

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE BASE
// ─────────────────────────────────────────────────────────────────────────────

/** A single chunk of indexed knowledge from a document. */
export interface KnowledgeChunk {
  /** Unique chunk identifier */
  id: string;

  /** Source document reference */
  source: KnowledgeSource;

  /** The chunk's text content */
  text: string;

  /** Embedding vector (null if not yet embedded) */
  embedding: number[] | null;

  /** Relevance score — populated during retrieval (0–1) */
  score?: number;

  /** Chunk metadata */
  metadata: {
    /** Title / heading the chunk falls under */
    title?: string;
    /** Page number (for PDFs) */
    page?: number;
    /** Section path, e.g., ["HR Policies", "Leave"] */
    section?: string[];
    /** Character offset in original document */
    charOffset?: number;
  };

  /** When this chunk was indexed */
  indexedAt: Date;
}

/** A source document that has been ingested into the knowledge base. */
export interface KnowledgeSource {
  /** Unique source identifier */
  id: string;

  /** Display name */
  name: string;

  /** Source type */
  type: "confluence" | "sharepoint" | "local_file" | "url" | "gdrive";

  /** URI / path to the source */
  uri: string;

  /** File extension or content type, e.g., "pdf", "md", "docx" */
  contentType: string;

  /** When the source was last ingested */
  lastIngested: Date;

  /** Content hash — used to detect changes for incremental re-index */
  contentHash: string;
}

/** Query result from the knowledge base. */
export interface KnowledgeQueryResult {
  query: string;
  chunks: KnowledgeChunk[];
  totalFound: number;
  retrievedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCEDURE LIBRARY
// ─────────────────────────────────────────────────────────────────────────────

/** A structured playbook step inside a Procedure. */
export interface ProcedureStep {
  /** Sequential step number (1-based) */
  id: number;

  /** Human-readable description of the step */
  description: string;

  /** Tool action to invoke, e.g., "browser.navigate" */
  tool: string;

  /** Parameters to pass to the tool */
  params: Record<string, unknown>;

  /** Step IDs this step depends on */
  dependsOn?: number[];

  /** Whether this step requires human approval before execution */
  requiresApproval?: boolean;
}

/** A verification check at the end of a procedure. */
export interface ProcedureVerification {
  /** What to check */
  check: string;

  /** Tool to use for the check */
  tool: string;

  /** Parameters for the check */
  params: Record<string, unknown>;

  /** Expected value or pattern */
  expected?: string;
}

/** A structured YAML playbook for a company procedure. */
export interface Procedure {
  /** Unique procedure identifier (slugified name) */
  id: string;

  /** Human-readable procedure name */
  name: string;

  /** Description of what this procedure does */
  description: string;

  /**
   * Natural-language trigger phrases.
   * Used for fuzzy-matching a request to the right procedure.
   */
  triggers: string[];

  /** Internal systems involved, by name or URL */
  systems: string[];

  /** Ordered steps to execute */
  steps: ProcedureStep[];

  /** Verification checks to run after completion */
  verification?: ProcedureVerification[];

  /** Risk level of executing this procedure */
  riskLevel: "low" | "medium" | "high" | "critical";

  /** File path of the source YAML */
  sourcePath?: string;
}

/** Result of a procedure lookup. */
export interface ProcedureMatch {
  procedure: Procedure;
  /** Match confidence (0–1) — how well the request matched the triggers */
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENTITY GRAPH
// ─────────────────────────────────────────────────────────────────────────────

/** A person in the company entity graph. */
export interface Person {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  team?: string;
  manager?: string; // ID of manager Person
  /** Aliases — e.g., ["john", "jsmith"] used for NL resolution */
  aliases: string[];
}

/** An internal system in the company entity graph. */
export interface InternalSystem {
  id: string;
  name: string;
  /** Base URL */
  url?: string;
  /** Authentication method */
  authMethod: "basic" | "oauth" | "saml" | "api_key" | "session" | "none";
  /** Department or team responsible for this system */
  owner: string;
  /** Brief description */
  description: string;
  /** Aliases — e.g., ["jira", "ticket system"] */
  aliases: string[];
}

/** A relationship in the entity graph */
export interface EntityRelationship {
  /** Source entity ID */
  from: string;
  /** Target entity ID */
  to: string;
  /** Relationship type */
  type: "manages" | "approves_for" | "owns_system" | "member_of" | "submits_to";
}

/** The full company entity graph. */
export interface EntityGraph {
  people: Person[];
  systems: InternalSystem[];
  relationships: EntityRelationship[];
  /** When this graph was last loaded/built */
  lastBuiltAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERMISSION MODEL
// ─────────────────────────────────────────────────────────────────────────────

/** Permission policy for a specific tool action. */
export interface ToolPermission {
  /** Tool action pattern, e.g., "browser.*", "email.send", "filesystem.delete" */
  toolPattern: string;
  /** Permission level */
  level: "allow" | "require_approval" | "deny";
  /** Optional condition — a JSON path expression, e.g., params.domain in allowedDomains */
  condition?: string;
  /** Reason for this rule */
  reason?: string;
}

/** A complete permission policy for the system. */
export interface PermissionPolicy {
  /** Policy name */
  name: string;

  /** Default action if no rule matches */
  defaultLevel: "allow" | "require_approval" | "deny";

  /** Ordered rules — first match wins */
  rules: ToolPermission[];

  /** Risk-level overrides */
  riskLevelRules: {
    low: "allow" | "require_approval";
    medium: "allow" | "require_approval";
    high: "require_approval" | "deny";
    critical: "require_approval" | "deny";
  };
}

/** Result of a permission check for a specific action. */
export interface PermissionCheckResult {
  toolName: string;
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  matchedRule?: ToolPermission;
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT RETRIEVAL RESULT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Full context retrieved for a task request.
 * This is injected into the planner prompt.
 */
export interface TaskContext {
  /** The original request */
  request: string;

  /** Matching procedures, ranked by confidence */
  procedures: ProcedureMatch[];

  /** Relevant knowledge chunks */
  knowledge: KnowledgeChunk[];

  /** Entities mentioned or relevant to the request */
  entities: {
    people: Person[];
    systems: InternalSystem[];
  };

  /** Human-readable summary for prompt injection */
  summary: string;

  /** When this context was retrieved */
  retrievedAt: Date;
}
