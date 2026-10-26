/**
 * PathGuard — Filesystem Sandbox Security
 *
 * Ensures all file operations remain within explicitly authorized directories
 * and prevents directory traversal attacks.
 */

import { resolve, normalize, isAbsolute } from "node:path";
import { ToolError } from "@concurrent/core";

export class PathGuard {
  /**
   * Resolve and validate that targetPath is permitted under allowedPaths.
   * If allowedPaths is empty, local workspace paths are allowed by default.
   */
  static assertAllowed(targetPath: string, allowedPaths: string[] = []): string {
    const resolved = resolve(normalize(targetPath));

    if (allowedPaths.length === 0) {
      // If no restrictions are configured, allow the resolved path
      return resolved;
    }

    const isPermitted = allowedPaths.some((allowed) => {
      const allowedResolved = resolve(normalize(allowed));
      // Target must be equal to or inside the allowed directory
      return resolved === allowedResolved || resolved.startsWith(allowedResolved + "\\") || resolved.startsWith(allowedResolved + "/");
    });

    if (!isPermitted) {
      throw new ToolError(
        "TOOL_PERMISSION_DENIED",
        `Access to path "${targetPath}" is forbidden. Allowed directories: [${allowedPaths.join(", ")}]`,
        { context: { path: targetPath, allowedPaths } },
      );
    }

    return resolved;
  }
}
