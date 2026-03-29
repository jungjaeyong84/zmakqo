FROM node:20-alpine

WORKDIR /app

# 패키지 설치(운영용만)
COPY package*.json ./
RUN npm ci --omit=dev

# 앱 소스 복사
COPY . .

# ✅ Cloud Run 기본 포트
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

# 실행
CMD ["node", "server.js"]
