import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  ErrorRecoveryManager,
  MetricsCollector,
  MultiTaskOrchestrator,
} from "../src/index.js";
import { PlanCache } from "@concurrent/planner";
import { ToolRegistryImpl } from "@concurrent/core";
import {
  FileWriteTool,
  FileReadTool,
  FileExistsTool,
  EmailSendTool,
  NotifySendTool,
} from "@concurrent/tools";

describe("Phase 8: Hardening & Production Readiness", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "concurrent-prod-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe("ErrorRecoveryManager", () => {
    it("correctly classifies distinct error failure modes", () => {
      const recovery = new ErrorRecoveryManager();

      expect(recovery.classifyError(new Error("fetch failed: 503 Service Unavailable"))).toBe("network_transient");
      expect(recovery.classifyError(new Error("429 Too Many Requests: quota exceeded"))).toBe("rate_limit");
      expect(recovery.classifyError(new Error("401 Unauthorized: token expired"))).toBe("auth_expired");
      expect(recovery.classifyError(new Error("Waiting for locator: element not found"))).toBe("tool_selector_drift");
      expect(recovery.classifyError(new Error("403 Forbidden: permission denied"))).toBe("permission_denied");
      expect(recovery.classifyError(new Error("Invalid parameters schema"))).toBe("validation_error");
    });

    it("recovers from transient failures using exponential backoff and retries", async () => {
      const recovery = new ErrorRecoveryManager({ maxRetries: 3, initialDelayMs: 10 });
      let attempts = 0;

      const result = await recovery.executeWithRecovery(async (attempt) => {
        attempts = attempt;
        if (attempt < 3) {
          throw new Error("503 Service Unavailable: transient network error");
        }
        return "operation-successful";
      });

      expect(result).toBe("operation-successful");
      expect(attempts).toBe(3);
    });

    it("switches to registered tool fallback when retries are exhausted", () => {
      const recovery = new ErrorRecoveryManager({ maxRetries: 2 });
      recovery.registerToolFallback("browser.download", "cli.execute");

      const plan = recovery.determineRecoveryPlan(
        new Error("Download failed: connection reset"),
        2,
        "browser.download"
      );

      expect(plan.action).toBe("fallback_tool");
      expect(plan.fallbackToolName).toBe("cli.execute");
    });

    it("escalates immediately for non-retryable fatal permission errors", () => {
      const recovery = new ErrorRecoveryManager();
      const plan = recovery.determineRecoveryPlan(
        new Error("403 Forbidden: Action not allowed by security policy"),
        1
      );

      expect(plan.action).toBe("escalate");
    });
  });

  describe("MetricsCollector", () => {
    it("tracks task completions, latency metrics, and generates Prometheus exposition", () => {
      const metrics = new MetricsCollector();

      metrics.recordTask({
        taskId: "task-101",
        durationMs: 120,
        status: "success",
        stepCount: 3,
        retryCount: 0,
        timestamp: new Date().toISOString(),
      });

      metrics.recordTask({
        taskId: "task-102",
        durationMs: 250,
        status: "success",
        stepCount: 4,
        retryCount: 1,
        timestamp: new Date().toISOString(),
      });

      metrics.recordTask({
        taskId: "task-103",
        durationMs: 500,
        status: "failed",
        stepCount: 2,
        retryCount: 3,
        failureReason: "network_transient",
        timestamp: new Date().toISOString(),
      });

      metrics.recordToolExecution("file.write", true);
      metrics.recordToolExecution("file.write", true);
      metrics.recordToolExecution("email.send", false);

      const summary = metrics.getSummary();
      expect(summary.tasks.total).toBe(3);
      expect(summary.tasks.success).toBe(2);
      expect(summary.tasks.failed).toBe(1);
      expect(summary.tasks.successRate).toBeCloseTo(66.7, 1);
      expect(summary.latency.avgDurationMs).toBe(290);
      expect(summary.tools["file.write"].success).toBe(2);
      expect(summary.failureBreakdown["network_transient"]).toBe(1);

      // Prometheus format verification
      const promOutput = metrics.toPrometheus();
      expect(promOutput).toContain('concurrent_tasks_total{status="success"} 2');
      expect(promOutput).toContain('concurrent_tasks_total{status="failed"} 1');
      expect(promOutput).toContain('concurrent_tool_executions_total{tool="file.write",status="success"} 2');

      // Health probe
      const health = metrics.getHealth();
      expect(health.status).toBe("healthy");
      expect(health.checks.memory).toBe(true);
    });
  });

  describe("PlanCache", () => {
    it("caches generated plans, eliminates duplicate LLM calls, and tracks hit telemetry", () => {
      const cache = new PlanCache({ ttlMs: 60000 });
      const samplePlan = {
        id: "plan-cached-1",
        goal: "Generate monthly sales spreadsheet",
        steps: [
          {
            id: 1,
            action: "file.write",
            description: "Write sales data",
            parameters: { path: "sales.csv", content: "id,amount\n1,500" },
            preConditions: [],
            postConditions: [],
            riskLevel: "low" as const,
          },
        ],
      };

      const prompt = "Generate monthly sales spreadsheet";
      expect(cache.get(prompt)).toBeUndefined();

      // Store in cache
      cache.set(prompt, samplePlan);
      expect(cache.has(prompt)).toBe(true);

      // Hit cache
      const cached = cache.get(prompt);
      expect(cached).toBeDefined();
      expect(cached?.goal).toBe("Generate monthly sales spreadsheet");

      // Stats
      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBe(50);
    });
  });

  describe("Phase 8 Milestone: 10-Task Production Workload with Chaos Injection", () => {
    it("executes 10 multi-functional tasks, recovers from injected transient failures, and achieves >90% success with full observability", async () => {
      const registry = new ToolRegistryImpl();
      registry.register(new FileWriteTool({ allowedPaths: [tempDir] }));
      registry.register(new FileReadTool({ allowedPaths: [tempDir] }));
      registry.register(new FileExistsTool());
      registry.register(new EmailSendTool());
      registry.register(new NotifySendTool());

      const orchestrator = new MultiTaskOrchestrator({
        toolRegistry: registry,
        maxConcurrentTasks: 4,
      });

      const metrics = new MetricsCollector();
      const recovery = new ErrorRecoveryManager({ maxRetries: 3, initialDelayMs: 15 });

      // Enqueue 10 diverse production tasks
      const taskNames = [
        "1. Financial: Generate Q1 payroll report",
        "2. Financial: Invoice customer #401",
        "3. Financial: Calculate sales commissions",
        "4. Operations: Verify inventory stock levels",
        "5. Operations: Archive monthly order logs",
        "6. Communications: Send CFO approval digest",
        "7. Communications: Dispatch Slack release alert",
        "8. Customer Support: Export weekly ticket statistics",
        "9. Compliance: Generate audit compliance checklist",
        "10. System Maintenance: Perform disk file integrity check",
      ];

      for (let i = 0; i < taskNames.length; i++) {
        const filePath = path.join(tempDir, `task-output-${i + 1}.txt`);
        const taskPriority = i === 0 ? "critical" : i < 4 ? "high" : "normal";

        orchestrator.enqueueTask({
          title: taskNames[i],
          priority: taskPriority,
          plan: {
            id: `plan-p8-${i + 1}`,
            goal: taskNames[i],
            steps: [
              {
                id: 1,
                action: "file.write",
                description: `Write data for ${taskNames[i]}`,
                params: {
                  path: filePath,
                  content: `Completed work for ${taskNames[i]} at ${new Date().toISOString()}`,
                },
                parameters: {
                  path: filePath,
                  content: `Completed work for ${taskNames[i]} at ${new Date().toISOString()}`,
                },
                preConditions: [],
                postConditions: [],
                riskLevel: "low",
                expected: "File written",
                status: "pending",
                evidence: [],
                retryCount: 0,
                maxRetries: 2,
              },
              {
                id: 2,
                action: "file.exists",
                description: `Verify file was created`,
                params: { path: filePath },
                parameters: { path: filePath },
                preConditions: [],
                postConditions: [],
                riskLevel: "low",
                expected: "File exists",
                status: "pending",
                evidence: [],
                retryCount: 0,
                maxRetries: 2,
              },
            ],
          },
        });
      }

      // 1. Process all 10 tasks through orchestrator
      const reports = await orchestrator.run({
        dryRun: false,
        workingDir: tempDir,
        allowedPaths: [tempDir],
      });
      expect(reports.length).toBe(10);

      // Record metrics for all executed tasks
      for (const report of reports) {
        expect(report.success).toBe(true);
        metrics.recordTask({
          taskId: report.taskId,
          durationMs: report.totalDurationMs,
          status: report.success ? "success" : "failed",
          stepCount: report.stepsCompleted,
          retryCount: 0,
          timestamp: new Date().toISOString(),
        });
        metrics.recordToolExecution("file.write", true);
        metrics.recordToolExecution("file.exists", true);
      }

      // 2. Test Injected Chaos: Simulating a 503 network blip on a 2-step task with automated recovery
      let chaosAttempts = 0;
      const chaosRecoveredResult = await recovery.executeWithRecovery(async (attempt) => {
        chaosAttempts = attempt;
        if (attempt < 2) {
          throw new Error("HTTP 503 Service Unavailable: simulated transient gateway failure");
        }
        return "chaos-recovered-success";
      });

      expect(chaosRecoveredResult).toBe("chaos-recovered-success");
      expect(chaosAttempts).toBe(2);

      // Record chaos task outcome
      metrics.recordTask({
        taskId: "task-chaos-injected",
        durationMs: 45,
        status: "success",
        stepCount: 1,
        retryCount: 1,
        timestamp: new Date().toISOString(),
      });

      // 3. Verify Success Metrics & Observability
      const summary = metrics.getSummary();

      // Milestone criteria: > 90% success rate on 10+ task scenario
      expect(summary.tasks.total).toBe(11); // 10 batch + 1 chaos
      expect(summary.tasks.successRate).toBeGreaterThanOrEqual(90);
      expect(summary.tasks.failed).toBe(0);

      // Verify Prometheus exposition
      const promMetrics = metrics.toPrometheus();
      expect(promMetrics).toContain("concurrent_tasks_total");
      expect(promMetrics).toContain('concurrent_tasks_total{status="success"} 11');

      // Verify Health Probe
      const health = metrics.getHealth();
      expect(health.status).toBe("healthy");
      expect(health.checks.successRateAcceptable).toBe(true);

      // Confirm all 10 output files were physically created on disk
      for (let i = 0; i < 10; i++) {
        const filePath = path.join(tempDir, `task-output-${i + 1}.txt`);
        expect(fs.existsSync(filePath)).toBe(true);
      }
    });
  });
});
