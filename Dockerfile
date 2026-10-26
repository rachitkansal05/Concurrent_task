# ==========================================
# CONCURRENT — Autonomous Company Operator
# Production Dockerfile
# ==========================================

# Stage 1: Build & Compile
FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Copy root manifests
COPY package*.json ./
COPY tsconfig.base.json ./
COPY tsconfig.json ./

# Copy packages and apps manifests
COPY packages/core/package.json packages/core/
COPY packages/planner/package.json packages/planner/
COPY packages/tools/package.json packages/tools/
COPY packages/context/package.json packages/context/
COPY packages/verifier/package.json packages/verifier/
COPY packages/gateway/package.json packages/gateway/
COPY packages/orchestrator/package.json packages/orchestrator/
COPY packages/audit/package.json packages/audit/
COPY apps/operator/package.json apps/operator/

# Install all dependencies (including devDependencies for TypeScript compilation)
RUN npm ci

# Copy entire source code
COPY packages/ packages/
COPY apps/ apps/
COPY config/ config/

# Compile TypeScript monorepo
RUN npm run build

# Stage 2: Production Runtime
FROM node:20-bookworm-slim AS runner

WORKDIR /app

# Install minimal OS dependencies for headless Chromium (Playwright) & curl for healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=3000
ENV CONCURRENT_WORKSPACE_ROOT=/app/workspace
ENV CONCURRENT_VAULT_KEY=concurrent-production-secure-vault-key-32-byte!

# Copy build artifacts and dependencies from builder stage
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/config ./config

# Create runtime directories for workspace, logs, and evidence
RUN mkdir -p /app/workspace /app/evidence /app/data

# Non-root user for security
RUN groupadd -r concurrent && useradd -r -g concurrent -d /app -s /sbin/nologin concurrent \
    && chown -R concurrent:concurrent /app

USER concurrent

EXPOSE 3000

# Container healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start operator daemon / API server
CMD ["node", "apps/operator/dist/index.js", "daemon"]
