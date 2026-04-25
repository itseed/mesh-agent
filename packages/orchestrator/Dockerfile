FROM node:20-alpine AS base
RUN npm install -g pnpm@9
# ติดตั้ง Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/orchestrator/package.json ./packages/orchestrator/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY --from=deps /app/packages/orchestrator/node_modules ./packages/orchestrator/node_modules
COPY packages/shared ./packages/shared
COPY packages/orchestrator ./packages/orchestrator
COPY tsconfig.base.json ./
RUN pnpm --filter @meshagent/orchestrator build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/packages/orchestrator/dist ./dist
COPY --from=builder /app/packages/orchestrator/package.json ./
COPY --from=deps /app/packages/orchestrator/node_modules ./node_modules
EXPOSE 3002
CMD ["node", "dist/index.js"]
