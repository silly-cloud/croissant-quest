# syntax=docker/dockerfile:1
# Build from the repo root: docker build -f apps/web/Dockerfile --build-arg API_URL=http://api:3001 .
# API_URL is baked into the /v1/* rewrite at `next build` time; changing it means rebuilding the image.

# node:22.23.4-bookworm-slim, multi-arch index digest checked against Docker Hub on 2026-10-24.
FROM node:22.23.4-bookworm-slim@sha256:de170b39439eb0e5a3444ad7d60b015614a381e10fecae2e30ec9e735122f38d AS base
ENV NEXT_TELEMETRY_DISABLED=1

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
# Must be set before `next build`: next.config.ts reads it to write the rewrite into routes-manifest.json.
ARG API_URL=http://api:3001
ENV API_URL=$API_URL
RUN pnpm --filter @cq/web build
# Prune to production deps (no standalone output, so `next start` runs from a pruned package).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @cq/web deploy --legacy --prod --store-dir /pnpm/store /prod/web
RUN rm -rf /repo/apps/web/.next/cache \
 && cp -r /repo/apps/web/.next /prod/web/.next \
 && mkdir -p /prod/web/public

FROM base AS runtime
ARG API_URL=http://api:3001
ENV NODE_ENV=production API_URL=$API_URL
WORKDIR /app
COPY --from=build /prod/web/package.json ./package.json
COPY --from=build /prod/web/node_modules ./node_modules
COPY --from=build /prod/web/next.config.ts ./next.config.ts
COPY --from=build /prod/web/public ./public
COPY --from=build /prod/web/.next ./.next
# Code stays root-owned; only Next's runtime cache dir is writable by the non-root `node` user.
RUN mkdir -p .next/cache && chown node:node .next/cache
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
CMD ["node", "node_modules/next/dist/bin/next", "start", "-p", "3000"]
