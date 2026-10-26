/**
 * Phase 4 — Verification & Evidence Test Suite
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { createTask } from "@concurrent/core";
import {
  VerificationEngine,
  PostConditionEngine,
  EvidenceCollector,
  EvidenceBundler,
  ConfidenceScorer,
  LLMVerifier,
  type PostCondition,
  type CheckContext,
  type VerifierLLMClient,
} from "../src/index.js";

describe("Phase 4: Verification & Evidence", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "concurrent-verifier-test-"));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Post-condition Engine & Programmatic Checks
  // ─────────────────────────────────────────────────────────────────────────────
  describe("PostConditionEngine", () => {
    let engine: PostConditionEngine;

    beforeEach(() => {
      engine = new PostConditionEngine();
    });

    it("should pass file_exists for an existing file and fail for missing", async () => {
      const filePath = path.join(tempDir, "test.txt");
      await fs.writeFile(filePath, "Hello world", "utf-8");

      const context: CheckContext = {
        taskId: "task-1",
        workingDir: tempDir,
        evidenceList: [],
      };

      const passResult = await engine.checkCondition(
        {
          id: "pc-1",
          name: "File should exist",
          type: "file_exists",
          params: { path: filePath },
        },
        context
      );
      expect(passResult.passed).toBe(true);
      expect(passResult.score).toBe(1.0);

      const failResult = await engine.checkCondition(
        {
          id: "pc-2",
          name: "Missing file should fail",
          type: "file_exists",
          params: { path: path.join(tempDir, "missing.txt") },
        },
        context
      );
      expect(failResult.passed).toBe(false);
      expect(failResult.score).toBe(0.0);
    });

    it("should verify file_size within bounds", async () => {
      const filePath = path.join(tempDir, "sized.dat");
      await fs.writeFile(filePath, Buffer.alloc(500));

      const context: CheckContext = { taskId: "task-1", evidenceList: [] };

      const passResult = await engine.checkCondition(
        {
          id: "pc-size-1",
          name: "Size bounds check",
          type: "file_size",
          params: { path: filePath, minBytes: 100, maxBytes: 1000 },
        },
        context
      );
      expect(passResult.passed).toBe(true);

      const failTooSmall = await engine.checkCondition(
        {
          id: "pc-size-2",
          name: "Too small check",
          type: "file_size",
          params: { path: filePath, minBytes: 600 },
        },
        context
      );
      expect(failTooSmall.passed).toBe(false);

      const failTooLarge = await engine.checkCondition(
        {
          id: "pc-size-3",
          name: "Too large check",
          type: "file_size",
          params: { path: filePath, maxBytes: 400 },
        },
        context
      );
      expect(failTooLarge.passed).toBe(false);
    });

    it("should verify file SHA-256 hash match and detect mismatch", async () => {
      const filePath = path.join(tempDir, "hashed.txt");
      const content = "Confidential report content";
      await fs.writeFile(filePath, content, "utf-8");
      const expectedHash = crypto.createHash("sha256").update(content).digest("hex");

      const context: CheckContext = { taskId: "task-1", evidenceList: [] };

      const passResult = await engine.checkCondition(
        {
          id: "pc-hash-1",
          name: "Correct hash",
          type: "file_hash",
          params: { path: filePath, sha256: expectedHash },
        },
        context
      );
      expect(passResult.passed).toBe(true);

      const failResult = await engine.checkCondition(
        {
          id: "pc-hash-2",
          name: "Mismatched hash",
          type: "file_hash",
          params: { path: filePath, sha256: "0000000000000000000000000000000000000000000000000000000000000000" },
        },
        context
      );
      expect(failResult.passed).toBe(false);
    });

    it("should check file_contains with text and regex", async () => {
      const filePath = path.join(tempDir, "content.log");
      await fs.writeFile(filePath, "Transaction ID: TXN-998822 completed successfully", "utf-8");

      const context: CheckContext = { taskId: "task-1", evidenceList: [] };

      const textMatch = await engine.checkCondition(
        {
          id: "pc-c-1",
          name: "Contains text",
          type: "file_contains",
          params: { path: filePath, pattern: "completed successfully" },
        },
        context
      );
      expect(textMatch.passed).toBe(true);

      const regexMatch = await engine.checkCondition(
        {
          id: "pc-c-2",
          name: "Contains regex",
          type: "file_contains",
          params: { path: filePath, pattern: "TXN-\\d{6}", isRegex: true },
        },
        context
      );
      expect(regexMatch.passed).toBe(true);

      const notFound = await engine.checkCondition(
        {
          id: "pc-c-3",
          name: "Missing pattern",
          type: "file_contains",
          params: { path: filePath, pattern: "FAILED" },
        },
        context
      );
      expect(notFound.passed).toBe(false);
    });

    it("should check http_status and http_json_field from step outputs", async () => {
      const context: CheckContext = {
        taskId: "task-api",
        evidenceList: [],
        stepOutputs: {
          1: {
            status: 200,
            body: {
              success: true,
              data: {
                reportId: "REP-2026-Q3",
                status: "approved",
              },
            },
          },
        },
      };

      const statusPass = await engine.checkCondition(
        {
          id: "pc-http-1",
          name: "HTTP 200 OK",
          type: "http_status",
          params: { stepId: 1, status: 200 },
        },
        context
      );
      expect(statusPass.passed).toBe(true);

      const jsonFieldPass = await engine.checkCondition(
        {
          id: "pc-json-1",
          name: "Check Report Status",
          type: "http_json_field",
          params: { stepId: 1, field: "data.status", expected: "approved" },
        },
        context
      );
      expect(jsonFieldPass.passed).toBe(true);

      const jsonFieldFail = await engine.checkCondition(
        {
          id: "pc-json-2",
          name: "Check Report Mismatch",
          type: "http_json_field",
          params: { stepId: 1, field: "data.status", expected: "rejected" },
        },
        context
      );
      expect(jsonFieldFail.passed).toBe(false);
    });

    it("should check dom_element_present and dom_text_contains", async () => {
      const context: CheckContext = {
        taskId: "task-dom",
        evidenceList: [
          {
            id: "ev-1",
            type: "text",
            value: "Confirmation Code: CONF-554432",
            timestamp: new Date().toISOString(),
            metadata: { selector: ".confirmation-box" },
          },
        ],
        stepOutputs: {
          2: {
            selector: "#submit-btn",
            extractedText: "Your expense report has been submitted",
          },
        },
      };

      const elPresent = await engine.checkCondition(
        {
          id: "pc-dom-1",
          name: "Selector present",
          type: "dom_element_present",
          params: { selector: ".confirmation-box" },
        },
        context
      );
      expect(elPresent.passed).toBe(true);

      const textPresent = await engine.checkCondition(
        {
          id: "pc-dom-2",
          name: "Text present",
          type: "dom_text_contains",
          params: { pattern: "CONF-554432" },
        },
        context
      );
      expect(textPresent.passed).toBe(true);
    });

    it("should check data_matches_pattern and data_field_equals", async () => {
      const context: CheckContext = {
        taskId: "task-data",
        evidenceList: [],
        stepOutputs: {
          1: {
            confirmationNumber: "EXP-889900",
            totalAmount: 450.5,
          },
        },
      };

      const patternMatch = await engine.checkCondition(
        {
          id: "pc-data-1",
          name: "Confirmation number pattern",
          type: "data_matches_pattern",
          params: { pattern: "^EXP-\\d{6}$" },
        },
        context
      );
      expect(patternMatch.passed).toBe(true);

      const fieldEqual = await engine.checkCondition(
        {
          id: "pc-data-2",
          name: "Field equality",
          type: "data_field_equals",
          params: { field: "confirmationNumber", expected: "EXP-889900" },
        },
        context
      );
      expect(fieldEqual.passed).toBe(true);
    });

    it("should support custom condition handlers", async () => {
      engine.registerCustomHandler("check_even_number", async (condition, ctx) => {
        const num = Number(condition.params.number);
        const passed = num % 2 === 0;
        return {
          conditionId: condition.id,
          name: condition.name,
          type: "custom",
          passed,
          score: passed ? 1.0 : 0.0,
          weight: 1.0,
          critical: false,
          message: passed ? "Number is even" : "Number is odd",
          durationMs: 1,
        };
      });

      const pass = await engine.checkCondition(
        {
          id: "pc-custom-1",
          name: "Custom Even Check",
          type: "custom",
          params: { handler: "check_even_number", number: 42 },
        },
        { taskId: "test", evidenceList: [] }
      );
      expect(pass.passed).toBe(true);

      const fail = await engine.checkCondition(
        {
          id: "pc-custom-2",
          name: "Custom Even Check Fail",
          type: "custom",
          params: { handler: "check_even_number", number: 41 },
        },
        { taskId: "test", evidenceList: [] }
      );
      expect(fail.passed).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. LLM Outcome Verifier
  // ─────────────────────────────────────────────────────────────────────────────
  describe("LLMVerifier", () => {
    it("should evaluate outcome using mock LLM client returning structured JSON", async () => {
      const mockLLM: VerifierLLMClient = {
        complete: async () => ({
          content: JSON.stringify({
            passed: true,
            score: 0.95,
            reasoning: "The email body precisely confirms expense approval and includes report ID.",
            criteriaResults: [
              { criterion: "Includes report ID", passed: true },
              { criterion: "States approval status", passed: true },
            ],
          }),
        }),
      };

      const verifier = new LLMVerifier(mockLLM);
      const result = await verifier.evaluate({
        conditionId: "llm-1",
        name: "Email Content Quality",
        prompt: "Verify email tone and completeness",
        expectedCriteria: ["Includes report ID", "States approval status"],
        contextData: { emailBody: "Your expense report EXP-123 has been approved." },
      });

      expect(result.passed).toBe(true);
      expect(result.score).toBe(0.95);
      expect(result.message).toContain("precisely confirms");
    });

    it("should use heuristic evaluation when no LLM client is configured", async () => {
      const verifier = new LLMVerifier();
      const result = await verifier.evaluate({
        conditionId: "llm-2",
        name: "Report verification",
        prompt: "Verify generated document contains required fields",
        expectedCriteria: ["expense", "total"],
        contextData: { title: "Expense Summary", total: 500 },
      });

      expect(result.passed).toBe(true);
      expect(result.score).toBeGreaterThan(0.5);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Evidence Collection & Bundling
  // ─────────────────────────────────────────────────────────────────────────────
  describe("EvidenceCollector and EvidenceBundler", () => {
    it("should collect various evidence items and compute SHA-256 for files", async () => {
      const collector = new EvidenceCollector("task-collect-1");

      // File
      const filePath = path.join(tempDir, "receipt.pdf");
      await fs.writeFile(filePath, "%PDF-1.4 sample receipt content", "utf-8");

      const fileItem = await collector.recordFileHash(filePath, 1);
      expect(fileItem.type).toBe("hash");
      expect(fileItem.sha256).toBeDefined();
      expect(fileItem.sha256!.length).toBe(64);

      // Screenshot
      const screenshotPath = path.join(tempDir, "screenshot.png");
      await fs.writeFile(screenshotPath, "fake image bytes", "utf-8");
      const screenshotItem = await collector.recordScreenshot(screenshotPath, 2);
      expect(screenshotItem.type).toBe("screenshot");
      expect(screenshotItem.sha256).toBeDefined();

      // API Response
      const apiItem = await collector.recordApiResponse(200, { ok: true, id: "XYZ" }, "https://api.com", 3);
      expect(apiItem.type).toBe("api_response");
      expect(apiItem.metadata?.status).toBe(200);

      // Confirmation ID
      const confItem = await collector.recordConfirmationId("CONF-9988", 4);
      expect(confItem.type).toBe("confirmation_id");
      expect(confItem.value).toBe("CONF-9988");

      expect(collector.getItems()).toHaveLength(4);
    });

    it("should bundle evidence into directory with manifest.json and REPORT.md", async () => {
      const collector = new EvidenceCollector("task-bundle-1");

      const docPath = path.join(tempDir, "summary.txt");
      await fs.writeFile(docPath, "Summary file data", "utf-8");
      await collector.recordFileHash(docPath, 1);
      await collector.recordConfirmationId("REF-12345", 2);

      const bundler = new EvidenceBundler({ baseOutputDir: path.join(tempDir, "bundles") });
      const bundle = await bundler.bundle("task-bundle-1", collector.getItems());

      expect(bundle.taskId).toBe("task-bundle-1");
      expect(bundle.items).toHaveLength(2);

      // Check manifest exists
      const manifestRaw = await fs.readFile(bundle.manifestPath, "utf-8");
      const manifest = JSON.parse(manifestRaw);
      expect(manifest.taskId).toBe("task-bundle-1");
      expect(manifest.summary.totalCount).toBe(2);

      // Check REPORT.md exists
      const reportPath = path.join(bundle.bundleDir, "REPORT.md");
      const reportContent = await fs.readFile(reportPath, "utf-8");
      expect(reportContent).toContain("# Verification & Evidence Report");
      expect(reportContent).toContain("REF-12345");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. Confidence Scoring
  // ─────────────────────────────────────────────────────────────────────────────
  describe("ConfidenceScorer", () => {
    const scorer = new ConfidenceScorer({ passThreshold: 0.8, reviewThreshold: 0.5 });

    it("should return passed when score exceeds passThreshold", () => {
      const evalResult = scorer.evaluate([
        {
          conditionId: "1",
          name: "Check 1",
          type: "file_exists",
          passed: true,
          score: 1.0,
          weight: 1.0,
          critical: false,
          message: "ok",
          durationMs: 1,
        },
        {
          conditionId: "2",
          name: "Check 2",
          type: "http_status",
          passed: true,
          score: 0.9,
          weight: 1.0,
          critical: false,
          message: "ok",
          durationMs: 1,
        },
      ]);

      expect(evalResult.status).toBe("passed");
      expect(evalResult.overallConfidence).toBe(0.95);
      expect(evalResult.passedCount).toBe(2);
    });

    it("should return failed when a critical condition fails, regardless of score", () => {
      const evalResult = scorer.evaluate([
        {
          conditionId: "1",
          name: "High Weight Non-Critical",
          type: "file_exists",
          passed: true,
          score: 1.0,
          weight: 10.0,
          critical: false,
          message: "ok",
          durationMs: 1,
        },
        {
          conditionId: "2",
          name: "Critical Security Check",
          type: "file_hash",
          passed: false,
          score: 0.0,
          weight: 1.0,
          critical: true,
          message: "hash mismatch",
          durationMs: 1,
        },
      ]);

      expect(evalResult.criticalFailure).toBe(true);
      expect(evalResult.status).toBe("failed");
      expect(evalResult.summary).toContain("Critical condition(s) failed");
    });

    it("should return needs_review when score falls between review and pass thresholds", () => {
      const evalResult = scorer.evaluate([
        {
          conditionId: "1",
          name: "Check 1",
          type: "file_exists",
          passed: true,
          score: 1.0,
          weight: 1.0,
          critical: false,
          message: "ok",
          durationMs: 1,
        },
        {
          conditionId: "2",
          name: "Check 2",
          type: "dom_text_contains",
          passed: false,
          score: 0.4,
          weight: 1.0,
          critical: false,
          message: "partial match",
          durationMs: 1,
        },
      ]);

      expect(evalResult.overallConfidence).toBe(0.7);
      expect(evalResult.status).toBe("needs_review");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. End-to-End VerificationEngine (Milestone Verification)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("VerificationEngine (Phase 4 Milestone)", () => {
    it("completes task verification, collects 3 forms of evidence (screenshot, file hash, API status), verifies all 3 pass, and bundles them into an audit-ready report", async () => {
      const bundleDir = path.join(tempDir, "evidence-output");
      const engine = new VerificationEngine({
        bundlerOptions: { baseOutputDir: bundleDir },
      });

      // 1. Create simulated completed task
      const task = createTask({
        request: "Submit monthly expense report to finance",
        requestedBy: "alice.cfo",
      });

      // Create test artifacts
      const screenshotFile = path.join(tempDir, "confirmation_screen.png");
      await fs.writeFile(screenshotFile, "PNG fake screenshot binary data", "utf-8");

      const exportedPdf = path.join(tempDir, "expense_report_2026.pdf");
      const pdfContent = "%PDF-1.4 Expense Report - Total: $1250.00";
      await fs.writeFile(exportedPdf, pdfContent, "utf-8");
      const expectedPdfHash = crypto.createHash("sha256").update(pdfContent).digest("hex");

      // Ingest evidence from execution
      task.evidence.push(
        {
          type: "screenshot",
          value: "confirmation_screen.png",
          path: screenshotFile,
          stepId: 1,
          timestamp: new Date(),
        },
        {
          type: "file",
          value: "expense_report_2026.pdf",
          path: exportedPdf,
          stepId: 2,
          timestamp: new Date(),
        },
        {
          type: "api_response",
          value: JSON.stringify({ status: "SUBMITTED", reportId: "EXP-9900" }),
          stepId: 3,
          timestamp: new Date(),
        }
      );

      // 2. Define 3 post-conditions:
      // Form 1: Screenshot file exists
      // Form 2: File SHA-256 hash verified
      // Form 3: API Response status verified
      const conditions: PostCondition[] = [
        {
          id: "verify-screen",
          name: "Screenshot confirmation exists",
          type: "file_exists",
          critical: true,
          params: { path: screenshotFile },
        },
        {
          id: "verify-hash",
          name: "Generated PDF hash verified",
          type: "file_hash",
          critical: true,
          params: { path: exportedPdf, sha256: expectedPdfHash },
        },
        {
          id: "verify-api",
          name: "API submission status verified",
          type: "http_status",
          params: { stepId: 3, status: 200 },
        },
      ];

      // 3. Run verification
      const report = await engine.verifyTask(task, {
        postConditions: conditions,
        stepOutputs: {
          3: { status: 200, reportId: "EXP-9900" },
        },
        workingDir: tempDir,
      });

      // 4. Verify outcomes
      expect(report.taskId).toBe(task.id);
      expect(report.status).toBe("passed");
      expect(report.overallConfidence).toBe(1.0);
      expect(report.passedCount).toBe(3);
      expect(report.failedCount).toBe(0);
      expect(report.criticalFailure).toBe(false);

      // Verify bundle
      expect(report.evidenceBundle.items).toHaveLength(3);
      const manifestFile = await fs.readFile(report.evidenceBundle.manifestPath, "utf-8");
      const manifest = JSON.parse(manifestFile);
      expect(manifest.summary.totalCount).toBe(3);

      const reportMd = await fs.readFile(
        path.join(report.evidenceBundle.bundleDir, "REPORT.md"),
        "utf-8"
      );
      expect(reportMd).toContain("PASS");
      expect(reportMd).toContain("Screenshot confirmation exists");
      expect(reportMd).toContain("Generated PDF hash verified");
      expect(reportMd).toContain("API submission status verified");
    });
  });
});
