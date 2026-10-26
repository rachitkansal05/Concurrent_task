/**
 * Phase 5 — Human-in-the-Loop & Escalation Test Suite
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  HumanGateway,
  ClarificationEngine,
  ApprovalWorkflow,
  EscalationEngine,
  WebDashboardChannel,
  ChatIntegrationChannel,
  CLIInteractionChannel,
  ChannelManager,
} from "../src/index.js";

describe("Phase 5: Human-in-the-Loop & Escalation", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Clarification Protocol
  // ─────────────────────────────────────────────────────────────────────────────
  describe("ClarificationEngine", () => {
    let clarifications: ClarificationEngine;

    beforeEach(() => {
      clarifications = new ClarificationEngine();
    });

    it("should ask a clarification question and resolve upon answer", async () => {
      const askPromise = clarifications.ask({
        taskId: "task-clar-1",
        question: "Which expense quarter should be exported?",
        options: [
          { id: "q1", label: "Q1", value: "Q1-2026" },
          { id: "q2", label: "Q2", value: "Q2-2026" },
          { id: "q3", label: "Q3", value: "Q3-2026" },
        ],
      });

      const pending = clarifications.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].question).toContain("expense quarter");

      // Human operator answers
      const answered = clarifications.answer(pending[0].id, "Q3-2026", "alice.operator");
      expect(answered).toBe(true);

      const result = await askPromise;
      expect(result).toBe("Q3-2026");

      const history = clarifications.getHistory();
      expect(history).toHaveLength(1);
      expect(history[0].status).toBe("answered");
      expect(history[0].answeredBy).toBe("alice.operator");
    });

    it("should use defaultValue on timeout", async () => {
      const result = await clarifications.ask({
        taskId: "task-clar-timeout",
        question: "Select export format",
        defaultValue: "pdf",
        timeoutMs: 50,
      });

      expect(result).toBe("pdf");
      const history = clarifications.getHistory();
      expect(history[0].status).toBe("timed_out");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. Approval Workflow
  // ─────────────────────────────────────────────────────────────────────────────
  describe("ApprovalWorkflow", () => {
    let approvals: ApprovalWorkflow;

    beforeEach(() => {
      approvals = new ApprovalWorkflow();
    });

    it("should request approval and resume with approved decision", async () => {
      const approvalPromise = approvals.requestApproval({
        taskId: "task-app-1",
        actionName: "email.send",
        riskLevel: "high",
        reason: "Sending financial data to external partner",
        parameters: { to: "auditor@external.com", subject: "Annual Audit" },
      });

      const pending = approvals.listPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].actionName).toBe("email.send");

      // Approve
      const decided = approvals.approve(pending[0].id, "finance-director", "Approved after review");
      expect(decided).toBe(true);

      const outcome = await approvalPromise;
      expect(outcome.approved).toBe(true);
      expect(outcome.decision).toBe("approved");
      expect(outcome.decidedBy).toBe("finance-director");
      expect(outcome.feedbackNote).toBe("Approved after review");
    });

    it("should support rejection of high-risk actions", async () => {
      const approvalPromise = approvals.requestApproval({
        taskId: "task-app-reject",
        actionName: "file.delete",
        riskLevel: "critical",
        reason: "Purge production archives",
        parameters: { path: "/var/log/prod" },
      });

      const pending = approvals.listPending();
      approvals.reject(pending[0].id, "secops", "Policy violation: retention required");

      const outcome = await approvalPromise;
      expect(outcome.approved).toBe(false);
      expect(outcome.decision).toBe("rejected");
      expect(outcome.feedbackNote).toContain("Policy violation");
    });

    it("should support parameter modification by human operator", async () => {
      const approvalPromise = approvals.requestApproval({
        taskId: "task-app-modify",
        actionName: "email.send",
        riskLevel: "medium",
        reason: "Emailing report",
        parameters: { to: "all-company@company.com", subject: "Draft Notice" },
      });

      const pending = approvals.listPending();
      // Operator modifies recipient from all-company to managers
      approvals.modify(
        pending[0].id,
        { to: "managers@company.com", subject: "Draft Notice" },
        "ops-lead",
        "Restricted audience to managers"
      );

      const outcome = await approvalPromise;
      expect(outcome.approved).toBe(true);
      expect(outcome.decision).toBe("modified");
      expect(outcome.modifiedParameters?.to).toBe("managers@company.com");
    });

    it("should automatically reject and resolve on timeout", async () => {
      const outcome = await approvals.requestApproval({
        taskId: "task-app-timeout",
        actionName: "cli.execute",
        riskLevel: "critical",
        reason: "Restart database",
        parameters: { command: "systemctl restart db" },
        timeoutMs: 50,
      });

      expect(outcome.approved).toBe(false);
      expect(outcome.decision).toBe("rejected");
      expect(outcome.decidedBy).toBe("system-timeout");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Escalation Protocol & Learning
  // ─────────────────────────────────────────────────────────────────────────────
  describe("EscalationEngine", () => {
    it("should create escalation and route to appropriate entity", async () => {
      const engine = new EscalationEngine();
      const escalation = await engine.escalate({
        taskId: "task-esc-1",
        trigger: "low_confidence",
        summary: "Unable to find invoice submit button after 3 DOM retries",
        attemptedSteps: [
          { stepId: 1, action: "browser.navigate", status: "success" },
          { stepId: 2, action: "browser.click", status: "failed", error: "Selector #submit-invoice not found" },
        ],
        assignedTo: {
          role: "Finance Systems Admin",
          name: "Dan Finance",
          email: "dan.finance@company.com",
          department: "Finance",
        },
      });

      expect(escalation.status).toBe("open");
      expect(escalation.trigger).toBe("low_confidence");
      expect(escalation.assignedTo.email).toBe("dan.finance@company.com");
      expect(engine.listOpen()).toHaveLength(1);

      // Resolve escalation and record human correction
      const resolved = engine.resolve(escalation.id, {
        resolutionNotes: "Invoice button was renamed to #finalize-invoice in v2 UI update.",
        procedureImprovementHint: "Update procedure selector from #submit-invoice to #finalize-invoice",
        resolvedBy: "dan.finance",
      });
      expect(resolved).toBe(true);
      expect(engine.listOpen()).toHaveLength(0);

      const corrections = engine.getCorrectionsLog();
      expect(corrections).toHaveLength(1);
      expect(corrections[0].procedureHint).toContain("finalize-invoice");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Communication Channels (Web Dashboard & Chat)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Communication Channels", () => {
    it("should format and record messages in ChatIntegrationChannel (Slack/Teams)", async () => {
      const chat = new ChatIntegrationChannel({ platform: "slack" });
      await chat.sendApprovalRequest({
        id: "app-chat-1",
        taskId: "task-chat",
        actionName: "email.send",
        riskLevel: "high",
        reason: "External dispatch",
        parameters: { to: "vendor@corp.com" },
        requestedAt: new Date().toISOString(),
        status: "pending",
      });

      const sent = chat.getSentMessages();
      expect(sent).toHaveLength(1);
      expect(sent[0].platform).toBe("slack");
      expect(sent[0].text).toContain("Approval Required");
      expect(sent[0].blocks).toBeDefined();
    });

    it("should run WebDashboardChannel HTTP server and handle REST approval decisions", async () => {
      const approvals = new ApprovalWorkflow();
      const web = new WebDashboardChannel({ port: 0 }); // port 0 = random ephemeral port

      web.setCallbacks({
        onApprovalDecision: async (id, decision, params) => {
          return approvals.decide(id, decision, {
            modifiedParameters: params?.modifiedParameters,
            decidedBy: params?.decidedBy,
            feedbackNote: params?.note,
          });
        },
      });

      const actualPort = await web.start();
      expect(actualPort).toBeGreaterThan(0);

      try {
        // 1. Request approval
        const approvalPromise = approvals.requestApproval({
          taskId: "task-rest-web",
          actionName: "email.send",
          riskLevel: "high",
          reason: "REST API Approval Test",
          parameters: { to: "board@company.com" },
        });

        const pending = approvals.listPending()[0];
        await web.sendApprovalRequest(pending);

        // 2. Query status endpoint via HTTP
        const statusRes = await fetch(`http://localhost:${actualPort}/api/status`);
        const statusData = await statusRes.json();
        expect(statusData.status).toBe("healthy");
        expect(statusData.pendingApprovals).toBe(1);

        // 3. Query approvals list endpoint via HTTP
        const listRes = await fetch(`http://localhost:${actualPort}/api/approvals`);
        const listData = await listRes.json();
        expect(listData).toHaveLength(1);
        expect(listData[0].id).toBe(pending.id);

        // 4. Submit approval decision via POST /api/approvals/:id/decide
        const decideRes = await fetch(`http://localhost:${actualPort}/api/approvals/${pending.id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "approved",
            decidedBy: "web-operator",
            note: "Approved via REST UI",
          }),
        });

        const decideData = await decideRes.json();
        expect(decideData.success).toBe(true);

        const outcome = await approvalPromise;
        expect(outcome.approved).toBe(true);
        expect(outcome.decidedBy).toBe("web-operator");
      } finally {
        await web.stop();
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. Phase 5 Milestone Verification
  // ─────────────────────────────────────────────────────────────────────────────
  describe("HumanGateway Milestone Verification", () => {
    it("detects high-risk action (external email), pauses, requests approval via dashboard, and resumes upon approval", async () => {
      // Setup unified gateway with Web Dashboard on ephemeral port
      const gateway = new HumanGateway({
        cli: true,
        web: { port: 0 },
        chat: { platform: "teams" },
      });

      const port = await gateway.startDashboard();
      expect(port).toBeDefined();

      try {
        // Simulated execution of step: email.send (high risk)
        let stepCompleted = false;

        // Step execution simulation waiting on human approval
        const executeHighRiskStep = async () => {
          // System detects high-risk action -> triggers gateway approval
          const approval = await gateway.requestApproval({
            taskId: "task-milestone-5",
            stepId: 4,
            actionName: "email.send",
            riskLevel: "high",
            reason: "External email dispatch of confidential Q3 financial summary",
            parameters: {
              to: "external-board@partner.com",
              subject: "Q3 Financial Summary",
              attachments: ["/evidence/q3_summary.pdf"],
            },
            consequences: "Information will leave company security perimeter.",
          });

          if (!approval.approved) {
            throw new Error(`Step execution blocked by human rejection: ${approval.feedbackNote}`);
          }

          // Step executes with approved/modified parameters
          stepCompleted = true;
          return {
            status: "success",
            dispatchedTo: approval.modifiedParameters?.to || "external-board@partner.com",
            approvedBy: approval.decidedBy,
          };
        };

        // Start step execution in background (pauses for approval)
        const stepPromise = executeHighRiskStep();

        // Verify system is paused waiting for approval
        expect(stepCompleted).toBe(false);
        const pending = gateway.approvals.listPending();
        expect(pending).toHaveLength(1);
        expect(pending[0].actionName).toBe("email.send");

        // Operator reviews and approves via REST API on dashboard
        const decideRes = await fetch(`http://localhost:${port}/api/approvals/${pending[0].id}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            decision: "approved",
            decidedBy: "chief-financial-officer",
            note: "Verified recipient identity and financial attachment integrity.",
          }),
        });
        const decideJson = await decideRes.json();
        expect(decideJson.success).toBe(true);

        // Step resumes and completes!
        const executionResult = await stepPromise;
        expect(stepCompleted).toBe(true);
        expect(executionResult.status).toBe("success");
        expect(executionResult.approvedBy).toBe("chief-financial-officer");
      } finally {
        await gateway.stopDashboard();
      }
    });
  });
});
