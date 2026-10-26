/**
 * Phase 6 — Multi-Task Orchestration Test Suite
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  ToolRegistryImpl,
  createTask,
  type Plan,
  type Step,
  type Observation,
} from "@concurrent/core";
import { registerAllTools } from "@concurrent/tools";
import {
  MultiTaskOrchestrator,
  TaskQueue,
  ResourceManager,
  DependencyManager,
  IterativeReplanner,
  LongRunningManager,
} from "../src/index.js";

describe("Phase 6: Multi-Task Orchestration", () => {
  let tempDir: string;
  let registry: ToolRegistryImpl;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "concurrent-orchestrator-test-"));
    registry = new ToolRegistryImpl();
    registerAllTools(registry);
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Prioritized Task Queue & Persistence
  // ─────────────────────────────────────────────────────────────────────────────
  describe("TaskQueue", () => {
    it("should prioritize critical tasks over normal and low tasks", async () => {
      const queue = new TaskQueue();

      const taskLow = createTask({ request: "Low priority task", requestedBy: "user1" });
      const taskNormal = createTask({ request: "Normal priority task", requestedBy: "user2" });
      const taskCritical = createTask({ request: "Critical priority task", requestedBy: "user3" });

      await queue.enqueue({ task: taskLow, priority: "low" });
      await queue.enqueue({ task: taskNormal, priority: "normal" });
      await queue.enqueue({ task: taskCritical, priority: "critical" });

      const completed = new Set<string>();
      const first = queue.getNextRunnableTask(completed);
      expect(first?.task.id).toBe(taskCritical.id);

      completed.add(taskCritical.id);
      await queue.markCompleted(taskCritical.id);

      const second = queue.getNextRunnableTask(completed);
      expect(second?.task.id).toBe(taskNormal.id);
    });

    it("should persist and reload snapshot from disk", async () => {
      const snapPath = path.join(tempDir, "queue-snapshot.json");
      const queue1 = new TaskQueue({ persistencePath: snapPath });

      const task1 = createTask({ request: "Persisted task", requestedBy: "user1" });
      await queue1.enqueue({ task: task1, priority: "high" });

      // Create new queue pointing to same snapshot file
      const queue2 = new TaskQueue({ persistencePath: snapPath });
      await queue2.loadSnapshot();

      expect(queue2.list()).toHaveLength(1);
      expect(queue2.get(task1.id)?.priority).toBe("high");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Resource Management & Rate Limiting
  // ─────────────────────────────────────────────────────────────────────────────
  describe("ResourceManager", () => {
    it("should limit concurrent task executions via semaphore", async () => {
      const manager = new ResourceManager({ maxConcurrentTasks: 2 });
      expect(manager.activeTasks).toBe(0);

      const release1 = await manager.acquireTaskSlot();
      expect(manager.activeTasks).toBe(1);

      const release2 = await manager.acquireTaskSlot();
      expect(manager.activeTasks).toBe(2);

      let thirdAcquired = false;
      const thirdPromise = manager.acquireTaskSlot().then((rel) => {
        thirdAcquired = true;
        return rel;
      });

      // Third should be queued waiting
      expect(thirdAcquired).toBe(false);

      // Release slot 1
      release1();
      const release3 = await thirdPromise;
      expect(thirdAcquired).toBe(true);

      release2();
      release3();
      expect(manager.activeTasks).toBe(0);
    });

    it("should limit concurrent browser sessions", async () => {
      const manager = new ResourceManager({ maxBrowserSessions: 1 });
      const release = await manager.acquireBrowserSession();
      expect(manager.activeBrowserSessions).toBe(1);

      let secondAcquired = false;
      const secondPromise = manager.acquireBrowserSession().then((r) => {
        secondAcquired = true;
        return r;
      });

      expect(secondAcquired).toBe(false);
      release();
      const release2 = await secondPromise;
      expect(secondAcquired).toBe(true);
      release2();
    });

    it("should enforce rate limiting tokens", async () => {
      const manager = new ResourceManager({ maxActionsPerSecond: 20 });
      // Should not throw or hang
      for (let i = 0; i < 5; i++) {
        await manager.rateLimit();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Task Dependency Management
  // ─────────────────────────────────────────────────────────────────────────────
  describe("DependencyManager", () => {
    it("should resolve dependencies and pipe outputs across tasks", () => {
      const deps = new DependencyManager();
      expect(deps.areDependenciesSatisfied(["task-1"])).toBe(false);

      deps.recordTaskCompletion("task-1", { reportUrl: "https://expenses.internal.com/rep-99.pdf" });
      expect(deps.areDependenciesSatisfied(["task-1"])).toBe(true);

      const plan: Plan = {
        taskId: "task-2",
        status: "draft",
        revision: 1,
        createdAt: new Date(),
        steps: [
          {
            id: 1,
            action: "email.send",
            params: {
              to: "audit@company.com",
              attachment: "{{task-1.output.reportUrl}}",
            },
            dependsOn: [],
            description: "Email report",
            expected: "Email sent",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
        ],
      };

      const pipedPlan = deps.pipeOutputsIntoPlan(plan, ["task-1"]);
      expect(pipedPlan.steps[0].params.attachment).toBe("https://expenses.internal.com/rep-99.pdf");
    });

    it("should detect failed parent dependencies", () => {
      const deps = new DependencyManager();
      deps.recordTaskFailure("task-parent");
      expect(deps.hasFailedDependency(["task-parent"])).toBe(true);
      expect(deps.hasFailedDependency(["task-other"])).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Iterative Re-planning
  // ─────────────────────────────────────────────────────────────────────────────
  describe("IterativeReplanner", () => {
    it("should splice alternative steps into plan upon dynamic condition", async () => {
      const replanner = new IterativeReplanner();

      const task = createTask({ request: "Multi-branch task", requestedBy: "user1" });
      const currentPlan: Plan = {
        taskId: task.id,
        status: "executing",
        revision: 1,
        createdAt: new Date(),
        steps: [
          {
            id: 1,
            action: "browser.navigate",
            params: { url: "https://portal.com" },
            dependsOn: [],
            description: "Load portal",
            expected: "Loaded",
            status: "success",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
          {
            id: 2,
            action: "browser.click",
            params: { selector: "#standard-flow" },
            dependsOn: [1],
            description: "Standard flow",
            expected: "Done",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
        ],
      };

      const triggerStep = currentPlan.steps[0];
      const observation: Observation = {
        stepId: 1,
        success: true,
        output: {
          branch: "mfa_required",
          requiresReplan: true,
          alternativeSteps: [
            {
              action: "browser.type",
              params: { selector: "#mfa-code", text: "123456" },
              description: "Enter MFA Code",
            },
            {
              action: "browser.click",
              params: { selector: "#submit-mfa" },
              description: "Submit MFA",
            },
          ],
        },
        evidence: [],
        summary: "MFA challenge was presented",
        timestamp: new Date(),
      };

      expect(replanner.shouldReplan(triggerStep, observation)).toBe(true);

      const revised = await replanner.replan(task, currentPlan, triggerStep, observation);
      expect(revised.revision).toBe(2);
      expect(revised.steps).toHaveLength(3); // step 1 (completed) + 2 new alternative steps
      expect(revised.steps[1].description).toBe("Enter MFA Code");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Long-running Tasks
  // ─────────────────────────────────────────────────────────────────────────────
  describe("LongRunningManager", () => {
    it("should poll until completion condition is met", async () => {
      const manager = new LongRunningManager();
      let checks = 0;

      const session = await manager.startMonitor({
        taskId: "task-monitor-1",
        checkIntervalMs: 20,
        maxDurationMs: 1000,
        checkAction: async (attempt) => {
          checks++;
          if (attempt >= 3) {
            return { completed: true, output: { status: "READY", fileReady: true } };
          }
          return { completed: false };
        },
      });

      expect(session.status).toBe("completed");
      expect(session.attempts).toBe(3);
      expect(session.lastOutput?.fileReady).toBe(true);
      expect(checks).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. Phase 6 Milestone Verification
  // ─────────────────────────────────────────────────────────────────────────────
  describe("MultiTaskOrchestrator Milestone Verification", () => {
    it("handles 3 concurrent tasks, each multi-step, without interference", async () => {
      const orchestrator = new MultiTaskOrchestrator(registry, {
        resourceLimits: {
          maxConcurrentTasks: 3,
          maxBrowserSessions: 2,
        },
      });

      // Task 1: Expense Report (2 steps: file.write, email.send)
      const task1 = createTask({ request: "Task 1: Generate Q3 Expense Report", requestedBy: "finance" });
      const plan1: Plan = {
        taskId: task1.id,
        status: "draft",
        revision: 1,
        createdAt: new Date(),
        steps: [
          {
            id: 1,
            action: "file.write",
            params: { path: path.join(tempDir, "t1_expense.txt"), content: "Q3 Report: $10,000" },
            dependsOn: [],
            description: "Write expense summary",
            expected: "File created",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
          {
            id: 2,
            action: "email.send",
            params: {
              to: "cfo@company.com",
              subject: "Expense Complete",
              body: "Please find attached the Q3 expense summary.",
            },
            dependsOn: [1],
            description: "Email CFO",
            expected: "Email sent",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
        ],
      };

      // Task 2: Sync CRM Records (2 steps: file.write, notify.send)
      const task2 = createTask({ request: "Task 2: Sync CRM Contacts", requestedBy: "sales" });
      const plan2: Plan = {
        taskId: task2.id,
        status: "draft",
        revision: 1,
        createdAt: new Date(),
        steps: [
          {
            id: 1,
            action: "file.write",
            params: { path: path.join(tempDir, "t2_crm.csv"), content: "id,name\n1,Acme" },
            dependsOn: [],
            description: "Write CRM sync cache",
            expected: "File created",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
          {
            id: 2,
            action: "notify.send",
            params: { channel: "sales-alerts", message: "CRM Synced 1 records" },
            dependsOn: [1],
            description: "Notify sales channel",
            expected: "Notification posted",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
        ],
      };

      // Task 3: Ingest Invoices (2 steps: file.write, file.exists)
      const task3 = createTask({ request: "Task 3: Process Invoices", requestedBy: "accounting" });
      const plan3: Plan = {
        taskId: task3.id,
        status: "draft",
        revision: 1,
        createdAt: new Date(),
        steps: [
          {
            id: 1,
            action: "file.write",
            params: { path: path.join(tempDir, "t3_invoice.json"), content: '{"invoices": [101, 102]}' },
            dependsOn: [],
            description: "Write invoice cache",
            expected: "File created",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
          {
            id: 2,
            action: "file.exists",
            params: { path: path.join(tempDir, "t3_invoice.json") },
            dependsOn: [1],
            description: "Verify invoice file",
            expected: "File exists",
            status: "pending",
            evidence: [],
            retryCount: 0,
            maxRetries: 2,
          },
        ],
      };

      // Track lifecycle events
      const startedTasks: string[] = [];
      const completedTasks: string[] = [];

      orchestrator.subscribe((event) => {
        if (event.type === "task:started") startedTasks.push(event.taskId);
        if (event.type === "task:completed") completedTasks.push(event.taskId);
      });

      // Submit all 3 tasks concurrently
      await orchestrator.submitTask({ task: task1, plan: plan1, priority: "high" });
      await orchestrator.submitTask({ task: task2, plan: plan2, priority: "normal" });
      await orchestrator.submitTask({ task: task3, plan: plan3, priority: "normal" });

      expect(orchestrator.queue.list()).toHaveLength(3);

      // Process all tasks through the orchestrator concurrently
      const reports = await orchestrator.processAll({
        dryRun: false,
        workingDir: tempDir,
        allowedPaths: [tempDir],
      });

      // Verify all 3 tasks completed successfully without interference
      expect(reports.size).toBe(3);
      expect(reports.get(task1.id)?.success).toBe(true);
      expect(reports.get(task2.id)?.success).toBe(true);
      expect(reports.get(task3.id)?.success).toBe(true);

      expect(reports.get(task1.id)?.stepsCompleted).toBe(2);
      expect(reports.get(task2.id)?.stepsCompleted).toBe(2);
      expect(reports.get(task3.id)?.stepsCompleted).toBe(2);

      expect(startedTasks).toHaveLength(3);
      expect(completedTasks).toHaveLength(3);

      // Verify all files created independently without collisions
      const t1Exists = await fs.stat(path.join(tempDir, "t1_expense.txt"));
      const t2Exists = await fs.stat(path.join(tempDir, "t2_crm.csv"));
      const t3Exists = await fs.stat(path.join(tempDir, "t3_invoice.json"));

      expect(t1Exists.isFile()).toBe(true);
      expect(t2Exists.isFile()).toBe(true);
      expect(t3Exists.isFile()).toBe(true);
    });
  });
});
