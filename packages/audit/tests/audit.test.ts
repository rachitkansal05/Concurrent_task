import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  CredentialVault,
  LogRedactor,
  DataClassifier,
  NetworkSecurityGuard,
  ImmutableAuditTrail,
  PermissionEnforcer,
  SecurityGateway,
  type DataClassificationLevel,
  type PermissionRule,
} from "../src/index.js";

describe("Phase 7: Security, Permissions & Audit Layer", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "concurrent-audit-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("LogRedactor", () => {
    it("redacts standard sensitive patterns: API keys, JWTs, private keys, SSNs, credit cards", () => {
      const redactor = new LogRedactor();
      const rawText = [
        "OpenAI key: sk-proj-1234567890abcdef1234567890abcdef",
        "GitHub token: ghp_1234567890abcdefghij1234567890abcdef",
        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        "Customer SSN: 123-45-6789",
        "Card: 4111 2222 3333 4444",
        "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----",
      ].join("\n");

      const redacted = redactor.redactText(rawText);

      expect(redacted).not.toContain("sk-proj-1234567890abcdef1234567890abcdef");
      expect(redacted).not.toContain("ghp_1234567890abcdefghij1234567890abcdef");
      expect(redacted).not.toContain("123-45-6789");
      expect(redacted).not.toContain("4111 2222 3333 4444");
      expect(redacted).toContain("[REDACTED_API_KEY]");
      expect(redacted).toContain("[REDACTED_SSN]");
      expect(redacted).toContain("[REDACTED_CREDIT_CARD]");
      expect(redacted).toContain("[REDACTED_PRIVATE_KEY]");
    });

    it("registers dynamic secrets and redacts them in text and complex nested objects", () => {
      const redactor = new LogRedactor();
      redactor.registerSecret("super-secret-db-password-999");
      redactor.registerSecret("internal-auth-token-xyz");

      const inputObj = {
        meta: {
          requestId: "req-1",
          nested: {
            authHeader: "Bearer internal-auth-token-xyz",
            dbUrl: "postgres://user:super-secret-db-password-999@db.internal:5432/main",
          },
        },
        tags: ["safe-tag", "super-secret-db-password-999"],
      };

      const sanitized = redactor.redactObject(inputObj) as typeof inputObj;

      expect(JSON.stringify(sanitized)).not.toContain("super-secret-db-password-999");
      expect(JSON.stringify(sanitized)).not.toContain("internal-auth-token-xyz");
      expect(sanitized.meta.nested.dbUrl).toContain("[REDACTED_SECRET]");
      expect(sanitized.tags[1]).toBe("[REDACTED_SECRET]");
    });
  });

  describe("CredentialVault", () => {
    it("securely stores, retrieves, and persists credentials with AES-256-GCM encryption", () => {
      const vaultPath = path.join(tempDir, "vault.json");
      const redactor = new LogRedactor();
      const vault = new CredentialVault({
        storagePath: vaultPath,
        masterKey: "my-ultra-secure-32-byte-master-key-xyz!",
        redactor,
      });

      vault.setCredential({
        id: "prod-stripe-key",
        name: "Stripe Production Secret",
        type: "api_key",
        secret: "sk_live_stripe_secret_key_abcdef123456",
        description: "Billing API key",
        environment: "production",
      });

      // Retrieval works
      const retrieved = vault.getSecret("prod-stripe-key");
      expect(retrieved).toBe("sk_live_stripe_secret_key_abcdef123456");

      // Verify disk storage does not contain raw secret
      const rawDiskContent = fs.readFileSync(vaultPath, "utf-8");
      expect(rawDiskContent).not.toContain("sk_live_stripe_secret_key_abcdef123456");
      expect(rawDiskContent).toContain("prod-stripe-key");

      // Auto-registration in redactor check: secret must be redacted immediately
      const testLog = `Failed call with secret: sk_live_stripe_secret_key_abcdef123456`;
      expect(redactor.redactText(testLog)).not.toContain("sk_live_stripe_secret_key_abcdef123456");
      expect(redactor.redactText(testLog)).toContain("[REDACTED_SECRET]");

      // Re-instantiating loads and decrypts correctly
      const vault2 = new CredentialVault({
        storagePath: vaultPath,
        masterKey: "my-ultra-secure-32-byte-master-key-xyz!",
      });
      expect(vault2.getSecret("prod-stripe-key")).toBe("sk_live_stripe_secret_key_abcdef123456");

      // Listing credentials metadata masks raw secrets
      const list = vault2.listCredentials();
      expect(list.length).toBe(1);
      expect((list[0] as unknown as { secret?: string }).secret).toBeUndefined();
    });

    it("rejects decryption with an invalid master key", () => {
      const vaultPath = path.join(tempDir, "vault-err.json");
      const vault = new CredentialVault({
        storagePath: vaultPath,
        masterKey: "test-fake-master-key-for-unit-tests",
      });
      vault.setCredential({
        id: "github-pat",
        name: "GitHub Token",
        type: "oauth_token",
        secret: "ghp_validTokenString1234567890",
      });

      const vaultTampered = new CredentialVault({
        storagePath: vaultPath,
        masterKey: "key-WRONG-PASSWORD-0000000000000000",
      });

      expect(() => vaultTampered.getSecret("github-pat")).toThrow();
    });
  });

  describe("DataClassifier", () => {
    it("correctly infers data classification levels and categories", () => {
      const classifier = new DataClassifier();

      const publicInfo = classifier.classifyContent("Hello public world documentation");
      expect(publicInfo.level).toBe("public");

      const confidentialPii = classifier.classifyContent("Customer SSN is 000-11-2222 with credit card 4111 1111 1111 1111");
      expect(["confidential", "restricted"]).toContain(confidentialPii.level);

      const restrictedSecret = classifier.classifyContent("Server private key: -----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----");
      expect(restrictedSecret.level).toBe("restricted");
    });

    it("evaluates external LLM egress guards", () => {
      const classifier = new DataClassifier();

      const safeAllowed = classifier.canTransmitToExternalLLM("General operational process guidelines without customer PII");
      expect(safeAllowed.allowed).toBe(true);

      const blockedRestricted = classifier.canTransmitToExternalLLM("The master database password is secret-password-123 and private key -----BEGIN PRIVATE KEY-----");
      expect(blockedRestricted.allowed).toBe(false);
      expect(blockedRestricted.reason).toBeDefined();
    });
  });

  describe("NetworkSecurityGuard", () => {
    it("enforces allowed domain whitelists and rejects unauthorized hosts", () => {
      const guard = new NetworkSecurityGuard({
        policy: {
          allowedDomains: ["api.github.com", "*.internal.acme.corp"],
          enforceTls: true,
          blockedPorts: [22, 25, 3389],
        },
      });

      expect(guard.isUrlAllowed("https://api.github.com/repos").allowed).toBe(true);
      expect(guard.isUrlAllowed("https://billing.internal.acme.corp/status").allowed).toBe(true);
      expect(guard.isUrlAllowed("https://attacker.evil.com/exfiltrate").allowed).toBe(false);
      expect(guard.isUrlAllowed("http://api.github.com/insecure").allowed).toBe(false); // Insecure HTTP blocked
      expect(guard.isUrlAllowed("http://localhost:8080/test").allowed).toBe(true); // Localhost allows HTTP
      expect(guard.isUrlAllowed("https://api.github.com:22/ssh").allowed).toBe(false); // Blocked port 22
    });
  });

  describe("ImmutableAuditTrail", () => {
    it("chains records with SHA-256 and detects tampering", () => {
      const auditLogPath = path.join(tempDir, "audit.jsonl");
      const redactor = new LogRedactor();
      const trail = new ImmutableAuditTrail({
        filePath: auditLogPath,
        redactor,
      });

      const r1 = trail.record({
        eventType: "task_started",
        taskId: "task-001",
        actor: { type: "system", id: "scheduler" },
        action: "task.start",
        details: { description: "Process quarterly payroll" },
      });

      const r2 = trail.record({
        eventType: "tool_executed",
        taskId: "task-001",
        actor: { type: "agent", id: "operator" },
        action: "database.query",
        status: "success",
        details: { query: "SELECT * FROM employees" },
      });

      const r3 = trail.record({
        eventType: "task_completed",
        taskId: "task-001",
        actor: { type: "system", id: "orchestrator" },
        action: "task.complete",
        status: "success",
        details: { durationMs: 1450 },
      });

      expect(r1.sequence).toBe(0);
      expect(r1.previousHash).toBe("0".repeat(64)); // Genesis block prev hash
      expect(r2.sequence).toBe(1);
      expect(r2.previousHash).toBe(r1.hash);
      expect(r3.sequence).toBe(2);
      expect(r3.previousHash).toBe(r2.hash);

      // Verify integrity of audit trail
      const integrityCheck = trail.verifyIntegrity();
      expect(integrityCheck.valid).toBe(true);
      expect(integrityCheck.recordsChecked).toBe(3);

      // Tamper detection test: modify a record directly in the file
      const rawLines = fs.readFileSync(auditLogPath, "utf-8").trim().split("\n");
      const record1Obj = JSON.parse(rawLines[1]);
      record1Obj.details.query = "SELECT * FROM passwords"; // Tamper with payload!
      rawLines[1] = JSON.stringify(record1Obj);
      fs.writeFileSync(auditLogPath, rawLines.join("\n"));

      const tamperedTrail = new ImmutableAuditTrail({ filePath: auditLogPath });
      const tamperedCheck = tamperedTrail.verifyIntegrity();
      expect(tamperedCheck.valid).toBe(false);
      expect(tamperedCheck.corruptedSequence).toBe(1);
    });

    it("supports structured query filtering and exports to CSV and JSONL", () => {
      const auditLogPath = path.join(tempDir, "audit-export.jsonl");
      const trail = new ImmutableAuditTrail({ filePath: auditLogPath });

      trail.record({
        eventType: "tool_executed",
        taskId: "task-A",
        actor: { type: "agent", id: "agent-1" },
        action: "file.write",
        status: "success",
      });

      trail.record({
        eventType: "permission_denied",
        taskId: "task-B",
        actor: { type: "agent", id: "agent-2" },
        action: "system.execute",
        status: "denied",
      });

      // Query filter
      const deniedRecords = trail.query({ eventType: "permission_denied" });
      expect(deniedRecords.length).toBe(1);
      expect(deniedRecords[0].action).toBe("system.execute");

      // Export formats
      const jsonlExport = trail.exportJSONL();
      expect(jsonlExport.split("\n").length).toBe(2);

      const csvExport = trail.exportCSV();
      expect(csvExport).toContain("sequence,id,timestamp,eventType,taskId");
      expect(csvExport).toContain("permission_denied");
    });
  });

  describe("PermissionEnforcer", () => {
    it("evaluates policies, blocks unauthorized actions, and logs to audit trail", () => {
      const auditLogPath = path.join(tempDir, "perm-audit.jsonl");
      const trail = new ImmutableAuditTrail({ filePath: auditLogPath });

      const rules: PermissionRule[] = [
        {
          id: "rule-filesystem",
          targetRole: "agent",
          allowedActions: ["file.read", "file.write"],
          forbiddenActions: ["file.delete"],
          conditions: {
            allowedPaths: ["/allowed/dir"],
          },
        },
        {
          id: "rule-admin-only",
          targetRole: "agent",
          forbiddenActions: ["system.execute", "database.drop"],
        },
      ];

      const enforcer = new PermissionEnforcer({ rules, auditTrail: trail });

      // Allowed action
      const allowedResult = enforcer.checkPermission({
        actorRole: "agent",
        actorId: "agent-worker",
        action: "file.read",
        taskId: "task-701",
        parameters: { path: "/allowed/dir/report.txt" },
      });
      expect(allowedResult.allowed).toBe(true);

      // Denied forbidden action
      const deniedResult = enforcer.checkPermission({
        actorRole: "agent",
        actorId: "agent-worker",
        action: "system.execute",
        taskId: "task-701",
      });
      expect(deniedResult.allowed).toBe(false);
      expect(deniedResult.reason).toContain("Forbidden");

      // Verify denial was automatically logged to audit trail
      const auditRecords = trail.query({ eventType: "permission_denied" });
      expect(auditRecords.length).toBe(1);
      expect(auditRecords[0].action).toBe("system.execute");
      expect(auditRecords[0].status).toBe("denied");
      expect(auditRecords[0].details.reason).toContain("Forbidden");
    });
  });

  describe("Phase 7 Milestone Validation: Coordinated Security Gateway", () => {
    it("executes full audit trail for a task; blocks permission violation; confirms zero credentials visible in logs", () => {
      const vaultPath = path.join(tempDir, "prod-vault.json");
      const auditLogPath = path.join(tempDir, "gateway-audit.jsonl");

      const security = new SecurityGateway({
        masterKey: "master-encryption-key-for-gateway-00!",
        vaultStoragePath: vaultPath,
        auditLogPath: auditLogPath,
        networkPolicy: {
          allowedDomains: ["api.github.com", "slack.com"],
          enforceTls: true,
        },
        permissionRules: [
          {
            id: "safe-tools",
            targetRole: "agent",
            allowedActions: ["web.fetch", "email.send", "vault.read"],
            forbiddenActions: ["database.delete", "terminal.sudo"],
          },
        ],
      });

      // 1. Store high-value credential in vault
      const secretToken = "sk-company-top-secret-token-88776655";
      security.vault.setCredential({
        id: "corp-api-key",
        name: "Corporate API Token",
        type: "api_key",
        secret: secretToken,
      });

      // 2. Start task audit
      security.audit.record({
        eventType: "task_started",
        taskId: "task-phase7-milestone",
        actor: { type: "system", id: "orchestrator" },
        action: "task.start",
        details: { request: `Process task using token ${secretToken}` },
      });

      // 3. Attempt unauthorized action -> correctly blocked and logged
      const permissionCheck = security.enforcer.checkPermission({
        actorRole: "agent",
        actorId: "worker-agent-1",
        action: "database.delete",
        taskId: "task-phase7-milestone",
      });
      expect(permissionCheck.allowed).toBe(false);

      // 4. Safe tool execution -> allowed
      const safeCheck = security.enforcer.checkPermission({
        actorRole: "agent",
        actorId: "worker-agent-1",
        action: "web.fetch",
        taskId: "task-phase7-milestone",
      });
      expect(safeCheck.allowed).toBe(true);

      // 5. Network egress check
      const netCheck = security.network.isUrlAllowed("https://api.github.com/user");
      expect(netCheck.allowed).toBe(true);
      const rogueNetCheck = security.network.isUrlAllowed("https://malicious-exfil.com/leak");
      expect(rogueNetCheck.allowed).toBe(false);

      // 6. Record safe completion
      security.audit.record({
        eventType: "task_completed",
        taskId: "task-phase7-milestone",
        actor: { type: "agent", id: "worker-agent-1" },
        action: "task.complete",
        status: "success",
        details: { result: `Completed with token: ${secretToken}` },
      });

      // Verify audit integrity
      const integrity = security.audit.verifyIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.recordsChecked).toBe(3); // start, denied attempt, complete

      // Verify Zero-Leak Guarantee: no credentials visible in any log or audit record
      const rawAuditTrail = fs.readFileSync(auditLogPath, "utf-8");
      expect(rawAuditTrail).not.toContain(secretToken);
      expect(rawAuditTrail).toContain("[REDACTED_SECRET]");

      // Check denied record in audit trail
      const deniedRecords = security.audit.query({ eventType: "permission_denied" });
      expect(deniedRecords.length).toBe(1);
      expect(deniedRecords[0].action).toBe("database.delete");
    });
  });
});
