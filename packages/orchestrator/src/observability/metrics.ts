/**
 * Observability & System Metrics Collector
 *
 * Collects task execution telemetry, tool reliability metrics, latency histograms,
 * failure taxonomy breakdowns, and generates Prometheus-compatible metrics and health probes.
 */

import { createLogger } from "@concurrent/core";

export interface TaskMetricRecord {
  taskId: string;
  taskType?: string;
  durationMs: number;
  status: "success" | "failed" | "escalated";
  stepCount: number;
  retryCount: number;
  failureReason?: string;
  timestamp: string;
}

export interface MetricsSummary {
  uptimeSeconds: number;
  tasks: {
    total: number;
    success: number;
    failed: number;
    escalated: number;
    successRate: number; // percentage 0-100
  };
  latency: {
    avgDurationMs: number;
    p95DurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
  };
  tools: Record<string, { total: number; success: number; failed: number }>;
  failureBreakdown: Record<string, number>;
}

export class MetricsCollector {
  private log = createLogger({ component: "metrics-collector" });
  private startTime = Date.now();
  private taskRecords: TaskMetricRecord[] = [];
  private toolInvocations: Map<string, { total: number; success: number; failed: number }> = new Map();
  private failureCounts: Map<string, number> = new Map();

  /** Record a completed task's telemetry */
  recordTask(metric: TaskMetricRecord): void {
    this.taskRecords.push({
      ...metric,
      timestamp: metric.timestamp || new Date().toISOString(),
    });

    if (metric.failureReason) {
      const count = this.failureCounts.get(metric.failureReason) || 0;
      this.failureCounts.set(metric.failureReason, count + 1);
    }

    this.log.debug({ taskId: metric.taskId, status: metric.status, durationMs: metric.durationMs }, "Task metric recorded");
  }

  /** Record a tool call outcome */
  recordToolExecution(toolName: string, success: boolean): void {
    const entry = this.toolInvocations.get(toolName) || { total: 0, success: 0, failed: 0 };
    entry.total += 1;
    if (success) {
      entry.success += 1;
    } else {
      entry.failed += 1;
    }
    this.toolInvocations.set(toolName, entry);
  }

  /** Compute comprehensive system telemetry summary */
  getSummary(): MetricsSummary {
    const total = this.taskRecords.length;
    const success = this.taskRecords.filter((r) => r.status === "success").length;
    const failed = this.taskRecords.filter((r) => r.status === "failed").length;
    const escalated = this.taskRecords.filter((r) => r.status === "escalated").length;
    const successRate = total > 0 ? (success / total) * 100 : 100;

    const durations = this.taskRecords.map((r) => r.durationMs).sort((a, b) => a - b);
    const avgDurationMs = total > 0 ? Math.round(durations.reduce((sum, d) => sum + d, 0) / total) : 0;
    const minDurationMs = durations.length > 0 ? durations[0] : 0;
    const maxDurationMs = durations.length > 0 ? durations[durations.length - 1] : 0;
    const p95Index = Math.min(Math.floor(durations.length * 0.95), Math.max(0, durations.length - 1));
    const p95DurationMs = durations.length > 0 ? durations[p95Index] : 0;

    const tools: Record<string, { total: number; success: number; failed: number }> = {};
    for (const [name, stats] of this.toolInvocations.entries()) {
      tools[name] = { ...stats };
    }

    const failureBreakdown: Record<string, number> = {};
    for (const [reason, count] of this.failureCounts.entries()) {
      failureBreakdown[reason] = count;
    }

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      tasks: {
        total,
        success,
        failed,
        escalated,
        successRate: Math.round(successRate * 10) / 10,
      },
      latency: {
        avgDurationMs,
        p95DurationMs,
        minDurationMs,
        maxDurationMs,
      },
      tools,
      failureBreakdown,
    };
  }

  /** Format metrics as Prometheus plaintext format */
  toPrometheus(): string {
    const summary = this.getSummary();
    const lines: string[] = [
      `# HELP concurrent_uptime_seconds Total runtime of the operator in seconds`,
      `# TYPE concurrent_uptime_seconds gauge`,
      `concurrent_uptime_seconds ${summary.uptimeSeconds}`,
      ``,
      `# HELP concurrent_tasks_total Total tasks handled by the system`,
      `# TYPE concurrent_tasks_total counter`,
      `concurrent_tasks_total{status="success"} ${summary.tasks.success}`,
      `concurrent_tasks_total{status="failed"} ${summary.tasks.failed}`,
      `concurrent_tasks_total{status="escalated"} ${summary.tasks.escalated}`,
      ``,
      `# HELP concurrent_task_duration_ms Average task completion duration in milliseconds`,
      `# TYPE concurrent_task_duration_ms gauge`,
      `concurrent_task_duration_ms{quantile="avg"} ${summary.latency.avgDurationMs}`,
      `concurrent_task_duration_ms{quantile="p95"} ${summary.latency.p95DurationMs}`,
      ``,
      `# HELP concurrent_tool_executions_total Tool execution counts`,
      `# TYPE concurrent_tool_executions_total counter`,
    ];

    for (const [tool, stats] of Object.entries(summary.tools)) {
      lines.push(`concurrent_tool_executions_total{tool="${tool}",status="success"} ${stats.success}`);
      lines.push(`concurrent_tool_executions_total{tool="${tool}",status="failed"} ${stats.failed}`);
    }

    return lines.join("\n") + "\n";
  }

  /** Health probe check */
  getHealth(): { status: "healthy" | "degraded" | "unhealthy"; uptime: number; checks: Record<string, boolean> } {
    const summary = this.getSummary();
    const isDegraded = summary.tasks.total >= 5 && summary.tasks.successRate < 80;

    return {
      status: isDegraded ? "degraded" : "healthy",
      uptime: summary.uptimeSeconds,
      checks: {
        memory: process.memoryUsage().heapUsed < 1.5 * 1024 * 1024 * 1024, // < 1.5GB
        successRateAcceptable: !isDegraded,
      },
    };
  }

  /** Reset all counters */
  reset(): void {
    this.taskRecords = [];
    this.toolInvocations.clear();
    this.failureCounts.clear();
    this.startTime = Date.now();
  }
}
