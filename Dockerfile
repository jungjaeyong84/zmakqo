FROM node:20-alpine

WORKDIR /app

# ─────────────────────────────────────────────────────────────────
# OpenClaw narrative reasoner (Phase C+) uses the official Anthropic
# `claude` CLI as its default provider when
#   OPENCLAW_NARRATIVE_PROVIDER_MODE=CLI (default).
# We install it here so Cloud Run has the binary available at
# /usr/local/bin/claude. Authentication still happens at runtime via
# the ANTHROPIC_API_KEY secret (mapped into the Cloud Run service as
# an env var); the CLI itself needs no extra Docker layer beyond the
# npm install + PATH.
#
# When OPENCLAW_NARRATIVE_PROVIDER_MODE=API is set, the CLI is unused
# and the Anthropic SDK is invoked directly — we keep the CLI in the
# image anyway so the operator can flip the provider mode without a
# rebuild.
# ─────────────────────────────────────────────────────────────────
RUN apk add --no-cache git ca-certificates \
 && npm install -g @anthropic-ai/claude-code@latest \
 && claude --version || true

# 패키지 설치(운영용만)
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY . .

# ✅ Cloud Run 기본 포트
ENV NODE_ENV=production
ENV PORT=8080

# ─────────────────────────────────────────────────────────────────
# OpenClaw default env (safe defaults — shadow-only until the
# operator flips via ops/deploy/apply_openclaw_phase.sh).
#
# Cloud Run secret wiring (managed outside the image):
#   ANTHROPIC_API_KEY                       -> secret binding (required
#                                              when PROVIDER_MODE=API; the
#                                              CLI path picks it up too
#                                              when it is set as env).
#   OPENCLAW_CLAUDE_CLI_BIN                 -> /usr/local/bin/claude
#   OPENCLAW_CLAUDE_CLI_MODEL               -> sonnet (haiku for cost)
#   OPENCLAW_CLAUDE_CLI_TIMEOUT_MS          -> 8000
#   OPENCLAW_NARRATIVE_PROVIDER_MODE        -> CLI (default) | API
#   OPENCLAW_NARRATIVE_ENABLED              -> 1 from Day 7 onward
#   OPENCLAW_NARRATIVE_LIVE_CALL_ENABLED    -> 1 from Day 7 onward
#   OPENCLAW_NARRATIVE_SHADOW_ONLY          -> 1 (Day 0..13) -> 0 (Day 14+)
#   OPENCLAW_AGENT_SHADOW_ENABLED           -> 1 (Day 0+)
#   OPENCLAW_AGENT_APPLY_ENABLED            -> 1 (Day 14+)
#   OPENCLAW_ML_GATE_ENABLED                -> 1 (Day 1+)
#   OPENCLAW_ML_MIN_TP1_PROB                -> 0.22
#   OPENCLAW_CONDUCTOR_ENABLED              -> 1 (Day 10+)
#   OPENCLAW_CONDUCTOR_SHADOW_ONLY          -> 1 (Day 10..16) -> 0 (Day 17+)
#   OPENCLAW_AGENT_AUTONOMY_ENABLED         -> 1 (Day 22+)
#   OPENCLAW_AUTONOMY_AUTO_DEGRADE          -> 1 (Day 22+)
#   OPENCLAW_AGENT_AUTONOMY_TRUST_FLOOR     -> 0.3
#   OPENCLAW_EVIDENCE_LEDGER_FIRESTORE      -> 1 (Day 0+)
# ─────────────────────────────────────────────────────────────────
ENV OPENCLAW_CLAUDE_CLI_BIN=/usr/local/bin/claude
ENV OPENCLAW_CLAUDE_CLI_MODEL=sonnet
ENV OPENCLAW_CLAUDE_CLI_TIMEOUT_MS=8000
ENV OPENCLAW_NARRATIVE_PROVIDER_MODE=CLI
ENV OPENCLAW_NARRATIVE_SHADOW_ONLY=1

EXPOSE 8080

# 실행
CMD ["node", "server.js"]
