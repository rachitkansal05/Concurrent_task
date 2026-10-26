import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FileWriteTool, FileReadTool, FileExistsTool, FileListTool, FileDeleteTool, PathGuard } from "../src/filesystem/index.js";
import { resolve } from "node:path";
import { existsSync, rmSync, mkdirSync } from "node:fs";

describe("Filesystem Tools & Security Sandbox", () => {
  const testDir = resolve("./tmp/test-fs");
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

  it("should enforce PathGuard sandboxing against unauthorized paths", () => {
    expect(() => PathGuard.assertAllowed("C:/Windows/System32", [testDir])).toThrowError(/forbidden/);
    expect(() => PathGuard.assertAllowed("../escape.txt", [testDir])).toThrowError(/forbidden/);
  });

  it("should write and read files within allowed sandbox", async () => {
    const writeTool = new FileWriteTool();
    const readTool = new FileReadTool();
    const filePath = resolve(testDir, "hello.txt");

    const writeRes = await writeTool.execute({ path: filePath, content: "Hello Autonomous World!" }, dummyContext);
    expect(writeRes.success).toBe(true);
    expect(existsSync(filePath)).toBe(true);

    const readRes = await readTool.execute({ path: filePath }, dummyContext);
    expect(readRes.success).toBe(true);
    expect(readRes.output.content).toBe("Hello Autonomous World!");
  });

  it("should list and delete files properly", async () => {
    const writeTool = new FileWriteTool();
    const listTool = new FileListTool();
    const deleteTool = new FileDeleteTool();
    const filePath = resolve(testDir, "temp.txt");

    await writeTool.execute({ path: filePath, content: "temp" }, dummyContext);

    const listRes = await listTool.execute({ path: testDir }, dummyContext);
    expect(listRes.success).toBe(true);
    expect(listRes.output.count).toBeGreaterThanOrEqual(1);

    const delRes = await deleteTool.execute({ path: filePath }, dummyContext);
    expect(delRes.success).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });
});
