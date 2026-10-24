# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/api/Dockerfile .
# Runtime needs DATABASE_URL (and optionally ANTHROPIC_API_KEY, PORT, WEB_ORIGIN) at `docker run` time;
# nothing secret is baked into the image.

# node:22.23.4-bookworm-slim, multi-arch index digest checked against Docker Hub on 2026-10-24.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
# Prisma's schema engine (used by `migrate deploy`) needs libssl; slim images do not ship openssl.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV CHECKPOINT_DISABLE=1

FROM base AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir /pnpm/store
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store

FROM deps AS build
# prisma generate (writes src/generated) + tsup (bundles @cq/*, keeps other deps external).
RUN pnpm --filter @cq/api build
# Prune to production deps. --legacy: workspace packages are not injected (pnpm 10 default deploy needs that).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @cq/api deploy --legacy --prod --store-dir /pnpm/store /prod/api
# `prisma` is a devDependency of @cq/api but is installed as the peer of @prisma/client, so it is in
# the pruned store without a top-level link. Link it so `prisma migrate deploy` and prisma.config.ts
# (`import "prisma/config"`) resolve. No-op once prisma is moved to dependencies.
RUN cd /prod/api/node_modules \
 && if [ ! -e prisma ]; then \
      set -- .pnpm/prisma@*/node_modules/prisma; \
      [ "$#" -eq 1 ] && [ -d "$1" ] || { echo "prisma CLI not found in deploy output: $*" >&2; exit 1; }; \
      ln -s "$1" prisma; \
    fi \
 && cp -r /repo/apps/api/dist /prod/api/dist

FROM base AS runtime
ENV NODE_ENV=production PORT=3001
WORKDIR /app
# Files stay root-owned (read-only for the app); the process runs as the image's non-root `node` user.
COPY --from=build /prod/api/package.json ./package.json
COPY --from=build /prod/api/node_modules ./node_modules
COPY --from=build /prod/api/dist ./dist
COPY --from=build /prod/api/prisma ./prisma
COPY --from=build /prod/api/prisma.config.ts ./prisma.config.ts
USER node
EXPOSE 3001
# Healthy only when the API answers and Postgres does too.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/v1/health').then(r=>r.json().then(b=>process.exit(r.ok&&b.db===true?0:1))).catch(()=>process.exit(1))"]
# Apply pending migrations (an empty DB otherwise answers 500), then hand PID 1 to node.
CMD ["sh", "-c", "node node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js"]
