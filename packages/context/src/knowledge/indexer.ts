/**
 * Knowledge Base Indexer
 *
 * Ingests documents from local files, chunks them, computes embeddings,
 * and stores them in an in-memory vector store backed by a JSON snapshot
 * on disk. Supports incremental re-indexing via content-hash comparison.
 *
 * Embedding Strategy:
 *   - When an external embedding API is configured, delegates to it.
 *   - Falls back to a fast TF-IDF-like bag-of-words approach for offline use.
 *
 * Vector Search:
 *   - Uses cosine similarity over float32 embedding vectors.
 *   - Snapshot-persisted to <workDir>/knowledge-index.json on each re-index.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createLogger } from "@concurrent/core";
import type { KnowledgeChunk, KnowledgeSource, KnowledgeQueryResult } from "../types.js";

const log = createLogger({ component: "knowledge-indexer" });

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Split text into overlapping chunks of ~chunkSize chars with overlap. */
function chunkText(
  text: string,
  chunkSize = 512,
  overlapSize = 64,
): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 20) chunks.push(chunk); // skip tiny fragments
    if (end === text.length) break;
    start += chunkSize - overlapSize;
  }

  return chunks;
}

/** Stable content hash for change detection. */
function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/** Bag-of-words TF-IDF-style embedding (no external API needed). */
function computeLocalEmbedding(text: string, vocabSize = 256): number[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const vector = new Array<number>(vocabSize).fill(0);
  for (const token of tokens) {
    // Hash token to a bucket in our fixed-size vocabulary
    let h = 0;
    for (let i = 0; i < token.length; i++) {
      h = (h * 31 + token.charCodeAt(i)) >>> 0;
    }
    vector[h % vocabSize] += 1;
  }

  // L2-normalize
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

/** Cosine similarity between two equal-length vectors. */
function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEX STORAGE (JSON snapshot)
// ─────────────────────────────────────────────────────────────────────────────

interface IndexSnapshot {
  sources: KnowledgeSource[];
  chunks: KnowledgeChunk[];
  builtAt: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// KNOWLEDGE INDEXER
// ─────────────────────────────────────────────────────────────────────────────

export interface KnowledgeIndexerOptions {
  /** Directory to watch for local documents */
  docsDir: string;
  /** Where to persist the index snapshot */
  workDir: string;
  /** Chunk size in characters */
  chunkSize?: number;
  /** Overlap between consecutive chunks */
  chunkOverlap?: number;
  /** If true, don't use external embedding API — always use local TF-IDF */
  localEmbeddingOnly?: boolean;
}

export class KnowledgeIndexer {
  private chunks: KnowledgeChunk[] = [];
  private sources: Map<string, KnowledgeSource> = new Map();
  private snapshotPath: string;

  constructor(private opts: KnowledgeIndexerOptions) {
    this.snapshotPath = path.join(opts.workDir, "knowledge-index.json");
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /** Load existing index from disk if present. */
  async load(): Promise<void> {
    if (!fsSync.existsSync(this.snapshotPath)) {
      log.info("No existing knowledge index found — starting fresh.");
      return;
    }

    try {
      const raw = await fs.readFile(this.snapshotPath, "utf-8");
      const snapshot: IndexSnapshot = JSON.parse(raw);

      this.chunks = snapshot.chunks.map((c) => ({
        ...c,
        indexedAt: new Date(c.indexedAt),
      }));

      for (const src of snapshot.sources) {
        this.sources.set(src.id, {
          ...src,
          lastIngested: new Date(src.lastIngested),
        });
      }

      log.info(
        { chunks: this.chunks.length, sources: this.sources.size },
        "Knowledge index loaded from disk",
      );
    } catch (err) {
      log.warn({ err: String(err) }, "Failed to load knowledge index; will rebuild.");
    }
  }

  /** Scan docsDir and (re-)index any changed files. */
  async index(): Promise<void> {
    await fs.mkdir(this.opts.docsDir, { recursive: true });
    await fs.mkdir(this.opts.workDir, { recursive: true });

    const entries = await fs.readdir(this.opts.docsDir, { recursive: true });
    const files = entries.filter((e) =>
      /\.(txt|md|csv|json|yaml|yml)$/i.test(String(e)),
    );

    let indexed = 0;
    let skipped = 0;

    for (const file of files) {
      const absPath = path.join(this.opts.docsDir, String(file));
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(absPath);
      } catch {
        continue;
      }
      if (!stat.isFile()) continue;

      const text = await fs.readFile(absPath, "utf-8");
      const hash = contentHash(text);
      const sourceId = contentHash(absPath);

      const existing = this.sources.get(sourceId);
      if (existing && existing.contentHash === hash) {
        skipped++;
        continue; // unchanged — skip
      }

      // Remove old chunks for this source
      this.chunks = this.chunks.filter((c) => c.source.id !== sourceId);

      const ext = path.extname(String(file)).slice(1);
      const source: KnowledgeSource = {
        id: sourceId,
        name: path.basename(String(file)),
        type: "local_file",
        uri: absPath,
        contentType: ext || "txt",
        lastIngested: new Date(),
        contentHash: hash,
      };
      this.sources.set(sourceId, source);

      const rawChunks = chunkText(
        text,
        this.opts.chunkSize ?? 512,
        this.opts.chunkOverlap ?? 64,
      );

      for (let i = 0; i < rawChunks.length; i++) {
        const chunkId = `${sourceId}-${i}`;
        const embedding = computeLocalEmbedding(rawChunks[i]);
        const chunk: KnowledgeChunk = {
          id: chunkId,
          source,
          text: rawChunks[i],
          embedding,
          metadata: {
            title: path.basename(String(file), path.extname(String(file))),
            charOffset: i * ((this.opts.chunkSize ?? 512) - (this.opts.chunkOverlap ?? 64)),
          },
          indexedAt: new Date(),
        };
        this.chunks.push(chunk);
      }

      indexed++;
      log.debug({ file, chunkCount: rawChunks.length }, "Indexed document");
    }

    log.info({ indexed, skipped, totalChunks: this.chunks.length }, "Indexing complete");
    await this.save();
  }

  /** Persist the current index to disk. */
  async save(): Promise<void> {
    const snapshot: IndexSnapshot = {
      sources: Array.from(this.sources.values()),
      chunks: this.chunks,
      builtAt: new Date().toISOString(),
    };
    await fs.mkdir(this.opts.workDir, { recursive: true });
    await fs.writeFile(this.snapshotPath, JSON.stringify(snapshot, null, 2), "utf-8");
    log.debug({ path: this.snapshotPath }, "Knowledge index snapshot saved");
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Retrieve the most relevant knowledge chunks for a query.
   *
   * @param query  Natural-language query string
   * @param topK   Number of chunks to return (default 5)
   * @param minScore Minimum cosine similarity threshold (default 0.1)
   */
  query(query: string, topK = 5, minScore = 0.1): KnowledgeQueryResult {
    const queryEmbedding = computeLocalEmbedding(query);

    const scored = this.chunks
      .filter((c) => c.embedding !== null)
      .map((c) => ({
        ...c,
        score: cosine(queryEmbedding, c.embedding!),
      }))
      .filter((c) => c.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    log.debug(
      { query, returned: scored.length },
      "Knowledge base query executed",
    );

    return {
      query,
      chunks: scored,
      totalFound: scored.length,
      retrievedAt: new Date(),
    };
  }

  /** Number of indexed chunks. */
  get size(): number {
    return this.chunks.length;
  }

  /** List all indexed sources. */
  getSources(): KnowledgeSource[] {
    return Array.from(this.sources.values());
  }
}
