/**
 * CLI Execute Tool
 *
 * Runs shell commands in an isolated subprocess with stdout/stderr capture,
 * timeout controls, and environment configuration.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { spawn } from "node:child_process";

const log = createLogger({ component: "cli.execute" });

export class CliExecuteTool implements Tool {
  readonly name = "cli.execute";
  readonly description = "Execute a shell command or script in a subprocess and capture stdout and stderr";
  readonly category = "cli";
  readonly riskLevel = "high";

  readonly parameters = {
    type: "object" as const,
    properties: {
      command: { type: "string" as const, description: "Shell command line to execute" },
      cwd: { type: "string" as const, description: "Working directory for execution" },
      timeoutMs: { type: "number" as const, description: "Maximum execution duration in ms (default: 30000)" },
    },
    required: ["command"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      exitCode: { type: "number" as const },
      stdout: { type: "string" as const },
      stderr: { type: "string" as const },
      success: { type: "boolean" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    if (!params.command || typeof params.command !== "string") {
      return { valid: false, errors: ["'command' parameter is required and must be a string."] };
    }
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const command = String(params.command);
    const cwd = params.cwd ? String(params.cwd) : context.workingDir || process.cwd();
    const timeoutMs = typeof params.timeoutMs === "number" ? params.timeoutMs : 30000;

    if (context.dryRun) {
      log.info({ command, cwd }, "[Dry Run] Executing CLI command");
      return {
        success: true,
        output: { exitCode: 0, stdout: "[Dry Run: Command simulated]", stderr: "", success: true },
        evidence: [{ type: "log", value: command, timestamp: new Date() }],
        durationMs: Date.now() - startTime,
      };
    }

    return new Promise((resolveResult, reject) => {
      log.debug({ command, cwd }, "Spawning shell subprocess");

      // On Windows, use shell: true to leverage cmd.exe / powershell
      const child = spawn(command, {
        shell: true,
        cwd,
        windowsHide: true,
      });

      let stdout = "";
      let stderr = "";

      const timeout = setTimeout(() => {
        child.kill("SIGTERM");
        reject(
          new ToolError("TOOL_TIMEOUT", `Command timed out after ${timeoutMs}ms: "${command}"`, {
            context: { command, timeoutMs },
          }),
        );
      }, timeoutMs);

      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(new ToolError("TOOL_EXECUTION_FAILED", `Subprocess error: ${err.message}`, { cause: err }));
      });

      child.on("close", (code) => {
        clearTimeout(timeout);
        const exitCode = code ?? 0;
        const success = exitCode === 0;

        resolveResult({
          success,
          output: {
            exitCode,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            success,
          },
          evidence: [
            {
              type: "log",
              value: `Exit ${exitCode}: ${stdout.slice(0, 500)}`,
              timestamp: new Date(),
              stepId: context.stepId,
            },
          ],
          durationMs: Date.now() - startTime,
        });
      });
    });
  }
}
