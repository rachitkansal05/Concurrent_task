import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DocumentGenerateTool, DocumentParseTool } from "../src/documents/index.js";
import { resolve } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";

describe("Document Tools", () => {
  const testDir = resolve("./tmp/test-docs");
  const dummyContext = {
    taskId: "test-task",
    stepId: 1,
    workingDir: testDir,
    previousOutputs: new Map(),
    allowedDomains: [],
    allowedPaths: [testDir],
    dryRun: false,
  };

  beforeEach(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("should generate populated document from template", async () => {
    const genTool = new DocumentGenerateTool();
    const outputPath = resolve(testDir, "report.txt");

    const result = await genTool.execute(
      {
        path: outputPath,
        template: "Quarterly Summary for {{department}}: Total Expenses: ${{amount}}",
        data: { department: "Engineering", amount: "45000" },
      },
      dummyContext,
    );

    expect(result.success).toBe(true);
    expect(existsSync(outputPath)).toBe(true);
  });

  it("should parse CSV and JSON documents", async () => {
    const csvPath = resolve(testDir, "data.csv");
    writeFileSync(csvPath, "id,name,role\n1,Alice,Engineer\n2,Bob,Finance\n", "utf-8");

    const parseTool = new DocumentParseTool();
    const result = await parseTool.execute({ path: csvPath }, dummyContext);

    expect(result.success).toBe(true);
    expect(result.output.recordCount).toBe(2);
    expect(result.output.columns).toEqual(["id", "name", "role"]);
  });
});
