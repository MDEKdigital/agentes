FROM node:22-alpine AS builder
RUN npm install -g pnpm@9.15.0
WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/shared/package.json    ./packages/shared/
COPY packages/database/package.json  ./packages/database/
COPY packages/queue/package.json     ./packages/queue/
COPY apps/api/package.json           ./apps/api/
RUN pnpm install --frozen-lockfile

COPY packages/ ./packages/
COPY apps/api/  ./apps/api/
RUN pnpm --filter=@aula-agente/api build

FROM node:22-alpine AS runner
RUN apk add --no-cache curl
WORKDIR /app

RUN npm install -g pnpm@9.15.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY packages/shared/package.json    ./packages/shared/
COPY packages/database/package.json  ./packages/database/
COPY packages/queue/package.json     ./packages/queue/
COPY apps/api/package.json           ./apps/api/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/apps/api/dist ./apps/api/dist

WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3001/health || exit 1
CMD ["node", "dist/server.js"]
