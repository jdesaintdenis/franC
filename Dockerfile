# syntax=docker/dockerfile:1

FROM node:22.22.2-alpine AS base
WORKDIR /app
RUN corepack enable

# ---- dev: hot-reloading container for `docker compose --profile app up` ----
FROM base AS dev
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
EXPOSE 3000
CMD ["pnpm", "dev"]

# ---- deps: production dependencies only ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

# ---- builder: full install + production build ----
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# The build only needs DATABASE_URL to be set, never reachable; the real one comes at run time.
RUN DATABASE_URL=postgres://build:build@localhost:5432/build pnpm build

# ---- production: minimal runtime image ----
FROM base AS production
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY package.json next.config.ts ./
EXPOSE 3000
CMD ["pnpm", "start"]
