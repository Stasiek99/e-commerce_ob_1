FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy workspace files
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY backend/package.json ./backend/

RUN pnpm install --frozen-lockfile

# Copy source files
COPY packages/shared-types/ ./packages/shared-types/
COPY backend/ ./backend/

# Build shared-types first
RUN pnpm --filter @fragrance-store/shared-types build

# Generate Prisma client & build backend
RUN pnpm --filter backend prisma:generate
RUN pnpm --filter backend build

# ── Production image ──────────────────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

RUN npm install -g pnpm

COPY --from=builder /app/pnpm-workspace.yaml ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/packages/shared-types/package.json ./packages/shared-types/
COPY --from=builder /app/backend/package.json ./backend/

RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist

EXPOSE 3000

CMD ["sh", "-c", "cd backend && npx prisma migrate deploy && node dist/main.js"]
