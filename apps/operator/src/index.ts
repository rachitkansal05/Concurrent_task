#!/usr/bin/env node
/**
 * Concurrent Operator — Main Entry Point
 *
 * Full Autonomous Company Operator CLI & Service:
 * - Phase 0: Core Foundation & Configuration
 * - Phase 1: Task Understanding & Planning
 * - Phase 2: Tool Execution Layer (Browser, Filesystem, CLI, Comms, Documents)
 * - Phase 3: Company Context Engine (Knowledge, Procedures, Entities, Permissions)
 * - Phase 4: Outcome Verification & Evidence Bundling
 * - Phase 5: Human-in-the-Loop Gateway (Approvals & Escalations)
 * - Phase 6: Multi-Task Orchestration & Resource Scheduling
 * - Phase 7: Security Gateway (Vault, Redactor, Audit Trail Chaining, Network Guard)
 * - Phase 8: Resilience, Plan Caching, Observability & Health Probes
 */

import * as path from "node:path";
import * as fs from "node:fs";
import {
  loadConfig,
  initLogger,
  createLogger,
  createTask,
  ToolRegistryImpl,
} from "@concurrent/core";
import { registerAllTools, closeSharedBrowserSession } from "@concurrent/tools";
import {
  createLLMClient,
  TaskClassifier,
  PlanGenerator,
  formatPlanForCLI,
  PlanCache,
} from "@concurrent/planner";
import {
  MultiTaskOrchestrator,
  MetricsCollector,
  ErrorRecoveryManager,
} from "@concurrent/orchestrator";
import { SecurityGateway } from "@concurrent/audit";
import { HumanGateway } from "@concurrent/gateway";
import { ContextEngine } from "@concurrent/context";
import { VerificationEngine, type PostCondition } from "@concurrent/verifier";

function parseArgs(): {
  taskRequest?: string;
  dryRun?: boolean;
  skipExecute?: boolean;
  daemon?: boolean;
} {
  const args = process.argv.slice(2);
  let taskRequest: string | undefined;
  let dryRun: boolean | undefined;
  let skipExecute = false;
  let daemon = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--task" || arg === "-t") {
      taskRequest = args[++i];
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--plan-only") {
      skipExecute = true;
    } else if (arg === "--daemon" || arg === "daemon" || arg === "--server") {
      daemon = true;
    } else if (!arg.startsWith("-") && !taskRequest) {
      taskRequest = arg;
    }
  }

  return { taskRequest, dryRun, skipExecute, daemon };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const args = parseArgs();
  if (args.dryRun !== undefined) {
    config.execution.dryRun = args.dryRun;
  }

  initLogger(config);
  const log = createLogger({ component: "operator" });

  console.log("================================================================================");
  console.log(`  CONCURRENT v${config.app.version} [${config.app.environment.toUpperCase()}]`);
  console.log("  Autonomous Company Operator — Enterprise Production Suite");
  console.log("================================================================================\n");

  // 1. Initialize Tool Execution Layer
  const toolRegistry = new ToolRegistryImpl();
  registerAllTools(toolRegistry);
  console.log(`[1/8 TOOLS] Initialized ${toolRegistry.list().length} action tools across 6 tiers (Browser, FS, CLI, Email, Notify, Docs).`);

  // 2. Initialize Security Gateway & Audit Trail (Phase 7)
  const dataDir = path.resolve(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const security = new SecurityGateway({
    masterKey: process.env.CONCURRENT_VAULT_KEY || "concurrent-production-secure-vault-key-32!",
    vaultStoragePath: path.join(dataDir, "vault.json"),
    auditLogPath: path.join(dataDir, "audit.jsonl"),
    networkPolicy: {
      allowedDomains: config.browser.allowedDomains || ["*"],
      enforceTls: true,
    },
    permissionRules: [
      {
        id: "block-root-deletion",
        targetRole: "agent",
        forbiddenActions: ["system.format", "database.drop"],
      },
    ],
  });
  console.log(`[2/8 SECURITY] Initialized AES-256-GCM Vault & Immutable SHA-256 Audit Trail (${security.audit.length} existing records).`);

  // 3. Initialize Company Context Engine (Phase 3)
  const contextEngine = new ContextEngine({
    knowledge: { docsDir: "docs", workDir: "tmp" },
    procedures: { proceduresDir: "config/procedures" },
    entities: { entitiesFilePath: "config/entities.yaml" },
    permissions: { policyFilePath: "config/permissions.yaml" },
  });
  await contextEngine.initialize();
  console.log(`[3/8 CONTEXT] Loaded ${contextEngine.knowledge.size} knowledge chunks and ${contextEngine.procedures.count} corporate SOP procedures.`);

  // 4. Initialize LLM & Plan Caching (Phase 1 & Phase 8)
  const llm = createLLMClient(config);
  const planCache = new PlanCache({ ttlMs: 3600 * 1000 });
  const classifier = new TaskClassifier(llm);
  const planner = new PlanGenerator(llm, toolRegistry);
  console.log(`[4/8 PLANNER] Connected to LLM provider (${llm.provider}:${llm.model}) with PlanCache active.`);

  // 5. Initialize Multi-Task Orchestrator & Resilience (Phase 6 & Phase 8)
  const orchestrator = new MultiTaskOrchestrator(toolRegistry, {
    resourceLimits: { maxConcurrentTasks: config.execution.maxConcurrentTasks || 4 },
  });
  const recovery = new ErrorRecoveryManager({ maxRetries: 3 });
  const metrics = new MetricsCollector();
  console.log(`[5/8 ORCHESTRATOR] Multi-Task Queue active with ErrorRecovery & Observability collector.`);

  // 6. Initialize Human Gateway (Phase 5)
  const humanGateway = new HumanGateway({
    cli: true,
    web: { port: 3456, autoStart: true },
  });
  console.log(`[6/8 GATEWAY] Web Control Dashboard & Approval Inbox live at http://localhost:3456\n`);

  if (args.daemon) {
    console.log("Operator running in DAEMON mode.");
    console.log("Web Control Dashboard & Approval Inbox live at: http://localhost:3456");
    console.log("Listening for incoming tasks and approvals. Press Ctrl+C to terminate.\n");

    return new Promise((resolve) => {
      process.on("SIGINT", () => {
        console.log("\nReceived SIGINT. Shutting down operator daemon...");
        resolve();
      });
      process.on("SIGTERM", () => resolve());
    });
  }

  // 7. Execute Request Workflow
  const requestText =
    args.taskRequest ||
    "Generate monthly expense reimbursement report and email digest to CFO";

  console.log(`--------------------------------------------------------------------------------`);
  console.log(`[TASK INTAKE] Processing: "${requestText}"`);
  console.log(`--------------------------------------------------------------------------------\n`);

  const task = createTask({
    request: requestText,
    requestedBy: "sarah.chen@acme.corp",
  });

  // Record task start in immutable audit chain
  security.audit.record({
    eventType: "task_started",
    taskId: task.id,
    actor: { type: "human", id: task.requestedBy || "user" },
    action: "task.start",
    details: { request: requestText },
  });

  // Step A: Retrieve Context
  console.log("Retrieving organizational context...");
  const taskContext = await contextEngine.retrieve(requestText, task.requestedBy);

  if (taskContext.procedures.length > 0) {
    const { procedure, confidence } = taskContext.procedures[0];
    console.log(`  * Matched SOP: "${procedure.name}" (confidence: ${Math.round(confidence * 100)}%, steps: ${procedure.steps.length})`);
  }
  if (taskContext.entities.people.length > 0) {
    console.log(`  * Resolved People: ${taskContext.entities.people.map((p) => `${p.name} (${p.role})`).join(", ")}`);
  }
  if (taskContext.entities.systems.length > 0) {
    console.log(`  * Target Systems: ${taskContext.entities.systems.map((s) => s.name).join(", ")}`);
  }

  // Step B: Classify & Formulate Plan
  console.log("\nAnalyzing task intent & evaluating risk level...");
  const classification = await classifier.classify(task.request);
  task.expandedRequest = classification.expandedRequest;
  task.type = classification.taskType;
  task.riskLevel = classification.riskLevel;
  console.log(`  * Type: ${task.type.toUpperCase()} | Risk: ${task.riskLevel.toUpperCase()}`);
  console.log(`  * Reasoning: ${classification.reasoning}`);

  let plan = planCache.get(requestText);
  if (plan) {
    console.log(`  * [PLAN CACHE HIT] Reusing cached deterministic plan.`);
  } else {
    console.log("  * Synthesizing multi-step DAG execution plan...");
    plan = await planner.generatePlan(task, [taskContext.summary]);
    planCache.set(requestText, plan);
  }
  task.plan = plan;

  console.log("\n" + formatPlanForCLI(plan, task));

  // Step C: Security & Permission Check
  console.log("Validating plan steps against corporate security policies...");
  for (const step of plan.steps) {
    const perm = security.enforcer.checkPermission({
      actorRole: "agent",
      action: step.action,
      taskId: task.id,
      stepId: step.id,
      riskLevel: (step as { riskLevel?: any }).riskLevel || task.riskLevel,
    });

    if (!perm.allowed) {
      console.log(`[SECURITY BLOCKED] Step ${step.id} (${step.action}) violated security policy: ${perm.reason}`);
      return;
    }
  }
  console.log("  * All steps permitted under active security policy.");

  // Step D: Execute Plan
  if (args.skipExecute) {
    console.log("\n[Plan completed: --plan-only flag provided]");
    return;
  }

  console.log("\nExecuting plan via MultiTaskOrchestrator...");
  const startTime = Date.now();
  const queuedTask = await orchestrator.enqueueTask({
    title: task.request,
    task,
    plan,
    priority: "high",
  });

  const reports = await orchestrator.run({
    dryRun: config.execution.dryRun,
    workingDir: config.filesystem.evidenceDir,
    allowedPaths: config.filesystem.allowedPaths,
  });

  const report = reports.find((r) => r.taskId === queuedTask.task.id) || reports[0];
  const durationMs = Date.now() - startTime;

  console.log("\n================================================================================");
  console.log(`  EXECUTION SUMMARY: ${report.success ? "SUCCESS" : "FAILED"}`);
  console.log(`  Steps Completed: ${report.stepsCompleted}/${report.totalSteps}`);
  console.log(`  Duration: ${durationMs}ms`);
  console.log("================================================================================\n");

  // Record tool invocations in metrics
  for (const step of plan.steps) {
    metrics.recordToolExecution(step.action, report.success);
  }

  // Step E: Verification Engine & Evidence Bundler (Phase 4)
  console.log("Running Outcome Verification & Evidence Bundler (Phase 4)...");
  const verificationEngine = new VerificationEngine({
    bundlerOptions: { baseOutputDir: config.filesystem.evidenceDir },
  });

  const conditions: PostCondition[] = [
    {
      id: "execution-complete",
      name: "All planned workflow steps executed successfully",
      type: "custom",
      critical: true,
      params: { handler: "execution-complete" },
    },
  ];

  verificationEngine.postConditions.registerCustomHandler("execution-complete", async () => {
    return {
      conditionId: "execution-complete",
      name: "All planned workflow steps executed successfully",
      type: "custom",
      passed: report.success,
      score: report.success ? 1.0 : 0.0,
      weight: 1.0,
      critical: true,
      message: `Completed ${report.stepsCompleted} of ${report.totalSteps} steps without error.`,
      durationMs: 1,
    };
  });

  const verificationReport = await verificationEngine.verifyTask(task, {
    postConditions: conditions,
    workingDir: config.filesystem.evidenceDir,
  });

  console.log(`  * Verification: ${verificationReport.status.toUpperCase()}`);
  console.log(`  * Confidence Score: ${(verificationReport.overallConfidence * 100).toFixed(1)}%`);
  console.log(`  * Evidence Bundle: ${verificationReport.evidenceBundle.bundleDir}`);

  // Step F: Immutable Audit Trail Integrity (Phase 7)
  security.audit.record({
    eventType: "task_completed",
    taskId: task.id,
    actor: { type: "system", id: "concurrent-operator" },
    action: "task.complete",
    status: report.success ? "success" : "failed",
    details: { durationMs, stepsCompleted: report.stepsCompleted },
  });

  const auditCheck = security.audit.verifyIntegrity();
  console.log(`\n[7/8 AUDIT PROOF] SHA-256 Micro-Blockchain Valid: ${auditCheck.valid} (${auditCheck.recordsChecked} chained records verified).`);

  // Step G: System Telemetry & Observability (Phase 8)
  metrics.recordTask({
    taskId: task.id,
    durationMs,
    status: report.success ? "success" : "failed",
    stepCount: report.stepsCompleted,
    retryCount: 0,
    timestamp: new Date().toISOString(),
  });

  const summary = metrics.getSummary();
  const health = metrics.getHealth();
  console.log(`[8/8 OBSERVABILITY] Health: ${health.status.toUpperCase()} | Success Rate: ${summary.tasks.successRate}% | Uptime: ${health.uptime}s`);

  await closeSharedBrowserSession();
  console.log("\n================================================================================");
  console.log("  Task execution lifecycle finished cleanly. Operator ready for next request.");
  console.log("================================================================================\n");

  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("\n[FATAL ERROR] Operator failed:", err);
  process.exit(1);
});
