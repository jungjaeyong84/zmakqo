FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache git ca-certificates

# 패키지 설치(운영용만)
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY . .

# ✅ Cloud Run 기본 포트
ENV NODE_ENV=production
ENV PORT=8080

# OpenClaw image defaults are runtime-safe. Cloud Run env may override
# operational flags, but the image must not carry alternate LLM providers.
ENV OPENCLAW_NARRATIVE_PROVIDER_MODE=CODEX_CLI_ONLY
ENV OPENAI_CODEX_FALLBACK_ENABLED=0
ENV OPENCLAW_NARRATIVE_SHADOW_ONLY=1

EXPOSE 8080

# 실행
CMD ["node", "server.js"]
