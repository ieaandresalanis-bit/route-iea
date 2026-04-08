# ── Stage 1: Build ────────────────────────────────────────────
FROM node:18-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json nest-cli.json ./
COPY prisma ./prisma
RUN npx prisma generate

COPY src ./src
RUN npm run build

# ── Stage 2: Production runtime ──────────────────────────────
FROM node:18-alpine AS runner
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma

EXPOSE ${PORT:-3000}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/health || exit 1

# Run migrations then start server
CMD npx prisma migrate deploy && node dist/main
