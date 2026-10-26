/**
 * Plan & LLM Response Cache
 *
 * Provides deterministic hashing and fast in-memory/disk caching of generated plans
 * to eliminate redundant LLM calls and achieve sub-second plan generation for routine workflows.
 */

import crypto from "node:crypto";
import { createLogger, type Plan } from "@concurrent/core";

export interface CachedPlanEntry {
  key: string;
  plan: Plan;
  createdAt: number;
  expiresAt: number;
  hits: number;
}

export interface PlanCacheOptions {
  ttlMs?: number; // default: 1 hour
  maxEntries?: number; // default: 500
}

export class PlanCache {
  private log = createLogger({ component: "plan-cache" });
  private cache: Map<string, CachedPlanEntry> = new Map();
  private ttlMs: number;
  private maxEntries: number;
  private totalHits = 0;
  private totalMisses = 0;

  constructor(options: PlanCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 3600 * 1000; // 1 hour
    this.maxEntries = options.maxEntries ?? 500;
  }

  /** Compute deterministic SHA-256 cache key from request parameters */
  computeKey(rawRequest: string, contextParams: Record<string, unknown> = {}): string {
    const normalizedRequest = rawRequest.trim().toLowerCase();
    const sortedContext = JSON.stringify(contextParams, Object.keys(contextParams).sort());
    return crypto
      .createHash("sha256")
      .update(`${normalizedRequest}::${sortedContext}`)
      .digest("hex");
  }

  /** Retrieve plan from cache if valid and unexpired */
  get(rawRequest: string, contextParams: Record<string, unknown> = {}): Plan | undefined {
    const key = this.computeKey(rawRequest, contextParams);
    const entry = this.cache.get(key);

    if (!entry) {
      this.totalMisses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.totalMisses++;
      this.log.debug({ key }, "Plan cache entry expired");
      return undefined;
    }

    entry.hits++;
    this.totalHits++;
    this.log.debug({ key, hits: entry.hits }, "Plan cache hit! Bypassing LLM call.");
    return JSON.parse(JSON.stringify(entry.plan)); // deep clone
  }

  /** Store a generated plan in cache */
  set(rawRequest: string, plan: Plan, contextParams: Record<string, unknown> = {}): void {
    const key = this.computeKey(rawRequest, contextParams);

    // Evict oldest if capacity reached
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }

    const now = Date.now();
    this.cache.set(key, {
      key,
      plan: JSON.parse(JSON.stringify(plan)),
      createdAt: now,
      expiresAt: now + this.ttlMs,
      hits: 0,
    });

    this.log.debug({ key, totalEntries: this.cache.size }, "Stored plan in cache");
  }

  /** Check if a request has a warm cached plan */
  has(rawRequest: string, contextParams: Record<string, unknown> = {}): boolean {
    const key = this.computeKey(rawRequest, contextParams);
    const entry = this.cache.get(key);
    return Boolean(entry && Date.now() <= entry.expiresAt);
  }

  /** Invalidate entry */
  delete(rawRequest: string, contextParams: Record<string, unknown> = {}): boolean {
    const key = this.computeKey(rawRequest, contextParams);
    return this.cache.delete(key);
  }

  /** Clear all cache */
  clear(): void {
    this.cache.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
  }

  /** Telemetry statistics */
  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.totalHits + this.totalMisses;
    const hitRate = total > 0 ? (this.totalHits / total) * 100 : 0;
    return {
      size: this.cache.size,
      hits: this.totalHits,
      misses: this.totalMisses,
      hitRate: Math.round(hitRate * 10) / 10,
    };
  }
}
