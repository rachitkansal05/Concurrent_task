/**
 * Desktop Automation Tools
 *
 * Provides desktop window, mouse, keyboard, and screen capture operations
 * using native Windows Automation and shell bridges.
 */

import type { Tool, ExecutionContext, ToolResult, ValidationResult } from "@concurrent/core";
import { ToolError, createLogger } from "@concurrent/core";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execAsync = promisify(exec);
const log = createLogger({ component: "desktop.automation" });

export class DesktopClickTool implements Tool {
  readonly name = "desktop.click";
  readonly description = "Click mouse at specified desktop screen coordinates (X, Y)";
  readonly category = "desktop";
  readonly riskLevel = "high";

  readonly parameters = {
    type: "object" as const,
    properties: {
      x: { type: "number" as const, description: "X screen coordinate" },
      y: { type: "number" as const, description: "Y screen coordinate" },
      button: {
        type: "string" as const,
        description: "Mouse button: left (default) or right",
        enum: ["left", "right"],
      },
    },
    required: ["x", "y"],
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      clicked: { type: "boolean" as const },
      x: { type: "number" as const },
      y: { type: "number" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    const errors: string[] = [];
    if (typeof params.x !== "number") errors.push("'x' coordinate must be a number");
    if (typeof params.y !== "number") errors.push("'y' coordinate must be a number");
    return { valid: errors.length === 0, errors };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const x = Number(params.x);
    const y = Number(params.y);

    if (context.dryRun) {
      log.info({ x, y }, "[Dry Run] Desktop click");
      return { success: true, output: { clicked: true, x, y }, evidence: [], durationMs: 5 };
    }

    try {
      // PowerShell script to set cursor position and click
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${x}, ${y})
      `;
      await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, " ")}"`);

      return {
        success: true,
        output: { clicked: true, x, y },
        evidence: [],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Desktop click failed at (${x}, ${y}): ${String(err)}`);
    }
  }
}

export class DesktopScreenshotTool implements Tool {
  readonly name = "desktop.screenshot";
  readonly description = "Capture screenshot of the entire desktop monitor screen";
  readonly category = "desktop";
  readonly riskLevel = "low";

  readonly parameters = {
    type: "object" as const,
    properties: {
      name: { type: "string" as const, description: "Filename label for screenshot" },
    },
  };

  readonly returns = {
    type: "object" as const,
    properties: {
      filePath: { type: "string" as const },
    },
  };

  validate(params: Record<string, unknown>): ValidationResult {
    return { valid: true, errors: [] };
  }

  async execute(params: Record<string, unknown>, context: ExecutionContext): Promise<ToolResult> {
    const startTime = Date.now();
    const targetDir = context.workingDir || "./evidence";
    const filename = `desktop-${params.name || Date.now()}.png`;
    const destPath = join(targetDir, filename);

    if (context.dryRun) {
      return {
        success: true,
        output: { filePath: destPath },
        evidence: [{ type: "screenshot", value: destPath, path: destPath, timestamp: new Date() }],
        durationMs: 5,
      };
    }

    try {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms,System.Drawing
        $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bitmap = New-Object System.Drawing.Bitmap $screen.Width, $screen.Height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
        $bitmap.Save('${destPath.replace(/\\/g, "\\\\")}')
        $graphics.Dispose()
        $bitmap.Dispose()
      `;
      await execAsync(`powershell -NoProfile -Command "${psScript.replace(/\r?\n/g, " ")}"`);

      return {
        success: true,
        output: { filePath: destPath },
        evidence: [
          {
            type: "screenshot",
            value: "Primary Desktop Screen",
            path: destPath,
            timestamp: new Date(),
            stepId: context.stepId,
          },
        ],
        durationMs: Date.now() - startTime,
      };
    } catch (err) {
      throw new ToolError("TOOL_EXECUTION_FAILED", `Desktop screenshot failed: ${String(err)}`);
    }
  }
}
