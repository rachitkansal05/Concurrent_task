# Concurrent Deployment & Operations Guide

## 1. Quick Start with Docker Compose

The fastest way to deploy the Autonomous Operator in production:

```bash
# 1. Clone repository & configure environment
git clone https://github.com/company/concurrent.git
cd concurrent
cp .env.example .env

# 2. Set master encryption key & LLM credentials
# Edit .env with your CONCURRENT_VAULT_KEY, OPENAI_API_KEY, etc.

# 3. Build and launch services
docker-compose up -d --build

# 4. Verify deployment health
curl http://localhost:3000/health
```

## 2. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | Yes | `production` | Node runtime environment |
| `PORT` | No | `3000` | HTTP port for REST API & web dashboard |
| `CONCURRENT_VAULT_KEY` | Yes | - | 32-byte secret for AES-256-GCM vault encryption |
| `OPENAI_API_KEY` | Optional | - | OpenAI API key for plan generation |
| `ANTHROPIC_API_KEY` | Optional | - | Anthropic Claude API key |
| `CONCURRENT_WORKSPACE_ROOT` | No | `/app/workspace` | Filesystem sandbox root directory |

## 3. Monitoring & Telemetry

### Health Check Endpoint
- **URL**: `GET /health`
- **Output**:
  ```json
  {
    "status": "healthy",
    "uptime": 14205,
    "checks": {
      "memory": true,
      "successRateAcceptable": true
    }
  }
  ```

### Prometheus Metrics Endpoint
- **URL**: `GET /metrics`
- **Scrape Interval**: 15s - 30s
- **Exposed Metrics**:
  - `concurrent_uptime_seconds`: Process runtime gauge
  - `concurrent_tasks_total`: Counter partitioned by status (`success`, `failed`, `escalated`)
  - `concurrent_task_duration_ms`: Latency gauge by quantile (`avg`, `p95`)
  - `concurrent_tool_executions_total`: Tool success/failure counter

## 4. Backup & Disaster Recovery

1. **Encrypted Vault**: Persisted in `./data/vault.json`. Back up this file together with your `CONCURRENT_VAULT_KEY`.
2. **Audit Logs**: Stored as append-only JSONL under `./data/audit.jsonl`. Back up regularly to secure S3/GCS bucket with write-once-read-many (WORM) storage.
3. **Evidence Artifacts**: Stored in `./evidence/<task-id>/`. Contains all screenshots, verification hashes, and reports.
