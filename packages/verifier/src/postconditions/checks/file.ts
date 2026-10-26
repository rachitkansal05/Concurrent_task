/**
 * File-based post-condition checks
 */

import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import type { CheckContext, ConditionCheckResult, PostCondition } from "../../types.js";

/** Check if a file exists on disk */
export async function checkFileExists(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const filePath = String(condition.params.path ?? "");
  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(context.workingDir ?? process.cwd(), filePath);

  try {
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      return {
        conditionId: condition.id,
        name: condition.name,
        type: condition.type,
        passed: false,
        score: 0.0,
        weight: condition.weight ?? 1.0,
        critical: condition.critical ?? false,
        message: `Path '${filePath}' exists but is not a file (it is a directory/special)`,
        durationMs: Date.now() - start,
      };
    }
    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: true,
      score: 1.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `File '${filePath}' exists (${stat.size} bytes)`,
      details: { path: resolvedPath, sizeBytes: stat.size },
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: false,
      score: 0.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `File does not exist: '${filePath}' (${errorMsg})`,
      durationMs: Date.now() - start,
    };
  }
}

/** Check file size constraints */
export async function checkFileSize(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const filePath = String(condition.params.path ?? "");
  const minBytes = typeof condition.params.minBytes === "number" ? condition.params.minBytes : 1;
  const maxBytes = typeof condition.params.maxBytes === "number" ? condition.params.maxBytes : Infinity;

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(context.workingDir ?? process.cwd(), filePath);

  try {
    const stat = await fs.stat(resolvedPath);
    const size = stat.size;

    if (size < minBytes) {
      return {
        conditionId: condition.id,
        name: condition.name,
        type: condition.type,
        passed: false,
        score: 0.0,
        weight: condition.weight ?? 1.0,
        critical: condition.critical ?? false,
        message: `File '${filePath}' size is ${size} bytes, which is below minimum ${minBytes} bytes`,
        details: { path: resolvedPath, size, minBytes, maxBytes },
        durationMs: Date.now() - start,
      };
    }

    if (size > maxBytes) {
      return {
        conditionId: condition.id,
        name: condition.name,
        type: condition.type,
        passed: false,
        score: 0.0,
        weight: condition.weight ?? 1.0,
        critical: condition.critical ?? false,
        message: `File '${filePath}' size is ${size} bytes, which exceeds maximum ${maxBytes} bytes`,
        details: { path: resolvedPath, size, minBytes, maxBytes },
        durationMs: Date.now() - start,
      };
    }

    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: true,
      score: 1.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `File '${filePath}' size is within expected range (${size} bytes)`,
      details: { path: resolvedPath, size, minBytes, maxBytes },
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: false,
      score: 0.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `Failed to check file size: '${filePath}' (${errorMsg})`,
      durationMs: Date.now() - start,
    };
  }
}

/** Check file SHA-256 hash */
export async function checkFileHash(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const filePath = String(condition.params.path ?? "");
  const expectedHash = String(condition.params.sha256 ?? "").toLowerCase();

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(context.workingDir ?? process.cwd(), filePath);

  try {
    const buffer = await fs.readFile(resolvedPath);
    const computedHash = crypto.createHash("sha256").update(buffer).digest("hex");

    if (expectedHash && computedHash !== expectedHash) {
      return {
        conditionId: condition.id,
        name: condition.name,
        type: condition.type,
        passed: false,
        score: 0.0,
        weight: condition.weight ?? 1.0,
        critical: condition.critical ?? false,
        message: `SHA-256 mismatch for '${filePath}': expected ${expectedHash}, got ${computedHash}`,
        details: { path: resolvedPath, expectedHash, computedHash },
        durationMs: Date.now() - start,
      };
    }

    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: true,
      score: 1.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `File '${filePath}' SHA-256 hash verified: ${computedHash}`,
      details: { path: resolvedPath, computedHash },
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: false,
      score: 0.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `Failed to compute hash for '${filePath}': ${errorMsg}`,
      durationMs: Date.now() - start,
    };
  }
}

/** Check file content contains substring or regex pattern */
export async function checkFileContains(
  condition: PostCondition,
  context: CheckContext
): Promise<ConditionCheckResult> {
  const start = Date.now();
  const filePath = String(condition.params.path ?? "");
  const pattern = condition.params.pattern;
  const isRegex = Boolean(condition.params.isRegex);

  const resolvedPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(context.workingDir ?? process.cwd(), filePath);

  try {
    const content = await fs.readFile(resolvedPath, "utf-8");
    let matches = false;

    if (isRegex) {
      const reg = new RegExp(String(pattern));
      matches = reg.test(content);
    } else {
      matches = content.includes(String(pattern));
    }

    if (!matches) {
      return {
        conditionId: condition.id,
        name: condition.name,
        type: condition.type,
        passed: false,
        score: 0.0,
        weight: condition.weight ?? 1.0,
        critical: condition.critical ?? false,
        message: `File '${filePath}' does not contain expected pattern '${pattern}'`,
        durationMs: Date.now() - start,
      };
    }

    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: true,
      score: 1.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `File '${filePath}' contains expected pattern '${pattern}'`,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      conditionId: condition.id,
      name: condition.name,
      type: condition.type,
      passed: false,
      score: 0.0,
      weight: condition.weight ?? 1.0,
      critical: condition.critical ?? false,
      message: `Failed to inspect content of '${filePath}': ${errorMsg}`,
      durationMs: Date.now() - start,
    };
  }
}
