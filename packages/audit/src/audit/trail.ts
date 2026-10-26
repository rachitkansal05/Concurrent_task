/**
 * Immutable Audit Trail
 *
 * Cryptographically chained audit log (each record references the SHA-256 hash
 * of its predecessor). Automatically applies log redaction to payloads and
 * verifies tamper-evidence.
 */

import crypto from "node:crypto";
import * as fsSync from "node:fs";
import path from "node:path";
import { createLogger, generateId } from "@concurrent/core";
import type {
  AuditActionType,
  AuditActor,
  AuditQueryFilter,
  AuditRecord,
  AuditTarget,
  DataClassificationLevel,
} from "../types.js";
import { LogRedactor } from "../redaction/redactor.js";

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";

export interface AuditTrailOptions {
  storagePath?: string;
  filePath?: string;
  redactor?: LogRedactor;
}

export interface ExtendedAuditRecord extends AuditRecord {
  sequence: number;
  action?: string;
  status?: string;
  details?: Record<string, unknown>;
}

export class ImmutableAuditTrail {
  private log = createLogger({ component: "audit-trail" });
  private records: ExtendedAuditRecord[] = [];
  private redactor: LogRedactor;
  private storagePath?: string;

  constructor(options: AuditTrailOptions = {}) {
    this.storagePath = options.storagePath || options.filePath;
    this.redactor = options.redactor || new LogRedactor();

    if (this.storagePath && fsSync.existsSync(this.storagePath)) {
      try {
        const raw = fsSync.readFileSync(this.storagePath, "utf-8");
        const lines = raw.trim().split("\n").filter((l) => l.trim().length > 0);
        this.records = lines.map((l) => {
          const rec = JSON.parse(l);
          if (rec.sequence === undefined) rec.sequence = rec.index;
          return rec;
        });
      } catch {
        // ignore load errors
      }
    }
  }

  /**
   * Append / record a new audit entry into the cryptographic chain.
   */
  record(params: {
    actionType?: string;
    eventType?: string;
    actor: AuditActor;
    target?: AuditTarget;
    action?: string;
    status?: string;
    payload?: Record<string, unknown>;
    details?: Record<string, unknown>;
    taskId?: string;
    stepId?: number;
    dataClassification?: DataClassificationLevel;
    riskLevel?: "low" | "medium" | "high" | "critical";
  }): ExtendedAuditRecord {
    const index = this.records.length;
    const previousHash = index === 0 ? GENESIS_HASH : this.records[index - 1].hash;
    const timestamp = new Date().toISOString();

    const actionType = (params.eventType || params.actionType || params.action || "audit_event") as AuditActionType;
    const target: AuditTarget = params.target || {
      toolName: params.action || "system",
      url: undefined,
    };

    // Redact details/payload to protect secrets and PII from ever being stored
    const rawDetails = params.details || params.payload || {};
    const redactedDetails = this.redactor.redactObject(rawDetails) as Record<string, unknown>;

    // Calculate cryptographic SHA-256 hash of this record
    const hashData = `${previousHash}|${index}|${timestamp}|${actionType}|${JSON.stringify(params.actor)}|${JSON.stringify(target)}|${JSON.stringify(redactedDetails)}`;
    const hash = crypto.createHash("sha256").update(hashData).digest("hex");

    const record: ExtendedAuditRecord = {
      id: generateId(),
      index,
      sequence: index,
      taskId: params.taskId,
      stepId: params.stepId,
      timestamp,
      actionType,
      action: params.action,
      status: params.status,
      actor: params.actor,
      target,
      riskLevel: params.riskLevel,
      dataClassification: params.dataClassification || "internal",
      payload: redactedDetails,
      details: redactedDetails,
      previousHash,
      hash,
    };

    this.records.push(record);
    this.log.debug({ index, actionType: record.actionType, hash: hash.slice(0, 12) }, "Audit record appended to chain");

    this.persistRecordSync(record);
    return record;
  }

  /** Alias for record */
  async append(params: Parameters<ImmutableAuditTrail["record"]>[0]): Promise<ExtendedAuditRecord> {
    return this.record(params);
  }

  /** Verify cryptographic integrity of the entire audit chain */
  verifyIntegrity(): {
    valid: boolean;
    recordsChecked: number;
    corruptedIndex?: number;
    corruptedSequence?: number;
    error?: string;
  } {
    for (let i = 0; i < this.records.length; i++) {
      const rec = this.records[i];
      const expectedPrevHash = i === 0 ? GENESIS_HASH : this.records[i - 1].hash;

      // 1. Verify previousHash pointer
      if (rec.previousHash !== expectedPrevHash) {
        return {
          valid: false,
          recordsChecked: i,
          corruptedIndex: i,
          corruptedSequence: i,
          error: `Broken hash chain at index ${i}: expected previousHash ${expectedPrevHash.slice(0, 10)}, got ${rec.previousHash.slice(0, 10)}`,
        };
      }

      // 2. Recompute and verify current hash
      const payloadToCheck = rec.details || rec.payload;
      const hashData = `${rec.previousHash}|${rec.index}|${rec.timestamp}|${rec.actionType}|${JSON.stringify(rec.actor)}|${JSON.stringify(rec.target)}|${JSON.stringify(payloadToCheck)}`;
      const computedHash = crypto.createHash("sha256").update(hashData).digest("hex");

      if (computedHash !== rec.hash) {
        return {
          valid: false,
          recordsChecked: i,
          corruptedIndex: i,
          corruptedSequence: i,
          error: `Data tampering detected at index ${i}: computed hash ${computedHash.slice(0, 10)} does not match record hash ${rec.hash.slice(0, 10)}`,
        };
      }
    }

    return {
      valid: true,
      recordsChecked: this.records.length,
    };
  }

  /** Query and filter audit records */
  query(filter: AuditQueryFilter & { eventType?: string } = {}): ExtendedAuditRecord[] {
    return this.records.filter((rec) => {
      if (filter.taskId && rec.taskId !== filter.taskId) return false;
      if (filter.eventType && rec.actionType !== filter.eventType) return false;
      if (filter.actionType && rec.actionType !== filter.actionType) return false;
      if (filter.actorId && rec.actor.id !== filter.actorId) return false;
      if (filter.dataClassification && rec.dataClassification !== filter.dataClassification) return false;
      if (filter.fromTime && new Date(rec.timestamp) < new Date(filter.fromTime)) return false;
      if (filter.toTime && new Date(rec.timestamp) > new Date(filter.toTime)) return false;
      return true;
    }).slice(0, filter.limit || undefined);
  }

  /** Export audit trail to JSONL string */
  exportToJsonl(filter?: AuditQueryFilter): string {
    const matches = this.query(filter);
    return matches.map((r) => JSON.stringify(r)).join("\n");
  }

  exportJSONL(filter?: AuditQueryFilter): string {
    return this.exportToJsonl(filter);
  }

  /** Export audit trail to CSV format */
  exportToCsv(filter?: AuditQueryFilter): string {
    const matches = this.query(filter);
    const headers = ["sequence", "id", "timestamp", "eventType", "taskId", "actor", "action", "status", "hash"];
    const rows = matches.map((r) => [
      r.sequence,
      r.id,
      r.timestamp,
      r.actionType,
      r.taskId || "",
      r.actor.id,
      r.action || r.target.toolName || "",
      r.status || "",
      r.hash.slice(0, 16),
    ]);

    return [headers.join(","), ...rows.map((row) => row.map((c) => `"${c}"`).join(","))].join("\n");
  }

  exportCSV(filter?: AuditQueryFilter): string {
    return this.exportToCsv(filter);
  }

  get length(): number {
    return this.records.length;
  }

  private persistRecordSync(record: ExtendedAuditRecord): void {
    if (!this.storagePath) return;

    try {
      fsSync.mkdirSync(path.dirname(this.storagePath), { recursive: true });
      fsSync.appendFileSync(this.storagePath, JSON.stringify(record) + "\n", "utf-8");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.error({ err: msg }, "Failed to append record to audit log file");
    }
  }

  /** Load chain from persistent JSONL file */
  async load(): Promise<void> {
    if (!this.storagePath) return;

    try {
      const raw = fsSync.readFileSync(this.storagePath, "utf-8");
      const lines = raw.trim().split("\n").filter((l) => l.trim().length > 0);
      this.records = lines.map((l) => {
        const rec = JSON.parse(l);
        if (rec.sequence === undefined) rec.sequence = rec.index;
        return rec;
      });
      this.log.info({ count: this.records.length }, "Loaded audit chain from disk");
    } catch {
      // file does not exist yet
    }
  }
}
