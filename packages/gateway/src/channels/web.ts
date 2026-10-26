/**
 * Web Dashboard Channel
 *
 * Provides a lightweight HTTP dashboard and REST API for human operator interaction.
 */

import http from "node:http";
import { createLogger } from "@concurrent/core";
import type {
  ApprovalDecision,
  ApprovalRequest,
  ClarificationRequest,
  EscalationRequest,
  InteractionChannel,
} from "../types.js";

export interface WebDashboardOptions {
  port?: number;
  host?: string;
  autoStart?: boolean;
}

export type ApprovalDecisionCallback = (
  requestId: string,
  decision: ApprovalDecision,
  params?: { modifiedParameters?: Record<string, unknown>; note?: string; decidedBy?: string }
) => Promise<boolean>;

export type ClarificationAnswerCallback = (
  requestId: string,
  answer: string,
  answeredBy?: string
) => Promise<boolean>;

export class WebDashboardChannel implements InteractionChannel {
  readonly name = "web";
  private log = createLogger({ component: "web-dashboard-channel" });
  private server?: http.Server;
  private port: number;
  private host: string;

  private approvals: Map<string, ApprovalRequest> = new Map();
  private clarifications: Map<string, ClarificationRequest> = new Map();
  private escalations: Map<string, EscalationRequest> = new Map();

  private onApprovalDecision?: ApprovalDecisionCallback;
  private onClarificationAnswer?: ClarificationAnswerCallback;

  constructor(options: WebDashboardOptions = {}) {
    this.port = options.port ?? 3456;
    this.host = options.host ?? "localhost";
    if (options.autoStart) {
      this.start();
    }
  }

  setCallbacks(callbacks: {
    onApprovalDecision?: ApprovalDecisionCallback;
    onClarificationAnswer?: ClarificationAnswerCallback;
  }): void {
    if (callbacks.onApprovalDecision) this.onApprovalDecision = callbacks.onApprovalDecision;
    if (callbacks.onClarificationAnswer) this.onClarificationAnswer = callbacks.onClarificationAnswer;
  }

  async sendApprovalRequest(request: ApprovalRequest): Promise<void> {
    this.approvals.set(request.id, request);
    this.log.info({ requestId: request.id, totalPending: this.approvals.size }, "Approval request registered in Web Dashboard");
  }

  async sendClarificationRequest(request: ClarificationRequest): Promise<void> {
    this.clarifications.set(request.id, request);
    this.log.info({ requestId: request.id }, "Clarification request registered in Web Dashboard");
  }

  async sendEscalationAlert(request: EscalationRequest): Promise<void> {
    this.escalations.set(request.id, request);
    this.log.warn({ requestId: request.id }, "Escalation registered in Web Dashboard");
  }

  /** Start HTTP server */
  async start(): Promise<number> {
    if (this.server) return this.port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          this.log.error({ err: String(err) }, "Unhandled HTTP request error");
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal Server Error" }));
        });
      });

      this.server.listen(this.port, this.host, () => {
        const addr = this.server?.address();
        if (typeof addr === "object" && addr) {
          this.port = addr.port;
        }
        this.log.info({ port: this.port, host: this.host }, "Web dashboard server running");
        resolve(this.port);
      });

      this.server.on("error", (err) => reject(err));
    });
  }

  /** Stop HTTP server */
  async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = undefined;
        this.log.info("Web dashboard server stopped");
        resolve();
      });
    });
  }

  getPort(): number {
    return this.port;
  }

  getUrl(): string {
    return `http://${this.host}:${this.port}`;
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. Health / Status
    if (pathname === "/api/status" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "healthy",
          pendingApprovals: Array.from(this.approvals.values()).filter((a) => a.status === "pending").length,
          pendingClarifications: Array.from(this.clarifications.values()).filter((c) => c.status === "pending").length,
          openEscalations: Array.from(this.escalations.values()).filter((e) => e.status === "open").length,
        })
      );
      return;
    }

    // 2. Approvals API
    if (pathname === "/api/approvals" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(this.approvals.values())));
      return;
    }

    const approvalMatch = pathname.match(/^\/api\/approvals\/([^/]+)\/decide$/);
    if (approvalMatch && req.method === "POST") {
      const requestId = approvalMatch[1];
      const body = await this.readJsonBody(req);
      const decision = body.decision as ApprovalDecision;

      if (!decision || !["approved", "rejected", "modified"].includes(decision)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid decision. Must be approved, rejected, or modified." }));
        return;
      }

      if (this.onApprovalDecision) {
        const modifiedParameters =
          typeof body.modifiedParameters === "object" && body.modifiedParameters !== null
            ? (body.modifiedParameters as Record<string, unknown>)
            : undefined;
        const note = typeof body.note === "string" ? body.note : undefined;
        const decidedBy = typeof body.decidedBy === "string" ? body.decidedBy : undefined;

        const success = await this.onApprovalDecision(requestId, decision, {
          modifiedParameters,
          note,
          decidedBy,
        });

        if (success) {
          const reqItem = this.approvals.get(requestId);
          if (reqItem) {
            reqItem.status = decision;
            reqItem.decision = decision;
            reqItem.decidedAt = new Date().toISOString();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, decision }));
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Approval request not found or already decided." }));
      return;
    }

    // 3. Clarifications API
    if (pathname === "/api/clarifications" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(this.clarifications.values())));
      return;
    }

    const clarMatch = pathname.match(/^\/api\/clarifications\/([^/]+)\/answer$/);
    if (clarMatch && req.method === "POST") {
      const requestId = clarMatch[1];
      const body = await this.readJsonBody(req);
      const answer = String(body.answer ?? "");
      const answeredBy = typeof body.answeredBy === "string" ? body.answeredBy : undefined;

      if (this.onClarificationAnswer) {
        const success = await this.onClarificationAnswer(requestId, answer, answeredBy);
        if (success) {
          const cItem = this.clarifications.get(requestId);
          if (cItem) {
            cItem.status = "answered";
            cItem.answer = answer;
            cItem.answeredAt = new Date().toISOString();
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, answer }));
          return;
        }
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Clarification request not found or already answered." }));
      return;
    }

    // 4. Escalations API
    if (pathname === "/api/escalations" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(Array.from(this.escalations.values())));
      return;
    }

    // 5. HTML Dashboard UI (fallback for root /)
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(this.renderHtmlDashboard());
  }

  private async readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => (data += chunk));
      req.on("end", () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (err) {
          reject(err);
        }
      });
      req.on("error", (err) => reject(err));
    });
  }

  private renderHtmlDashboard(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Concurrent — Human Operator Gateway</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; margin: 0; }
    h1 { color: #38bdf8; font-size: 1.5rem; margin-bottom: 1.5rem; }
    .card { background: #1e293b; border-radius: 8px; padding: 1.25rem; margin-bottom: 1rem; border: 1px solid #334155; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: bold; }
    .badge-high { background: #ef4444; color: white; }
    .badge-medium { background: #f59e0b; color: white; }
    .badge-low { background: #10b981; color: white; }
    button { cursor: pointer; padding: 0.5rem 1rem; border: none; border-radius: 4px; font-weight: bold; margin-right: 0.5rem; }
    .btn-approve { background: #10b981; color: white; }
    .btn-reject { background: #ef4444; color: white; }
  </style>
</head>
<body>
  <h1>Concurrent Autonomous Operator — Control Gateway</h1>
  <div class="card">
    <h2>Pending Approvals (${Array.from(this.approvals.values()).filter((a) => a.status === "pending").length})</h2>
    <div id="approvals">
      ${
        Array.from(this.approvals.values())
          .filter((a) => a.status === "pending")
          .map(
            (a) => `
        <div style="border-top: 1px solid #334155; padding: 0.75rem 0;">
          <span class="badge badge-${a.riskLevel}">${a.riskLevel.toUpperCase()}</span>
          <strong>${a.actionName}</strong> (Task: <code>${a.taskId}</code>)
          <p>${a.reason}</p>
          <pre style="background: #0f172a; padding: 0.5rem; border-radius: 4px;">${JSON.stringify(a.parameters, null, 2)}</pre>
        </div>`
          )
          .join("") || "<p style='color: #94a3b8;'>No pending approvals.</p>"
      }
    </div>
  </div>
</body>
</html>`;
  }
}
