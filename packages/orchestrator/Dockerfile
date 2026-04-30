FROM node:20-slim AS base
RUN npm install -g pnpm@9
RUN apt-get update && apt-get install -y --no-install-recommends tmux curl bash git ca-certificates && rm -rf /var/lib/apt/lists/*
# ติดตั้ง Claude Code CLI และ AI CLI tools อื่นๆ
RUN npm install -g @anthropic-ai/claude-code \
    && npm install -g @google/gemini-cli \
    && curl https://cursor.com/install -fsS | bash
# Create non-root user — Claude CLI refuses --dangerously-skip-permissions as root
RUN useradd -ms /bin/bash nodeuser
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
RUN chown -R nodeuser /app
USER nodeuser
EXPOSE 3002
CMD ["node", "dist/index.js"]
