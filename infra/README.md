# infra

`docker compose -f infra/docker-compose.yml --env-file infra/.env up --build` starts Postgres, the API (:3001) and the web app (:3000). The build context is the repo root, so `/.dockerignore` applies.

## Images

Both Dockerfiles use the same layout: `deps` (corepack pnpm@10.28.0, `pnpm fetch` + `pnpm install --offline --frozen-lockfile`, store in a BuildKit cache mount), then `build`, then `runtime`. The runtime stage has no pnpm and no store, runs as the non-root `node` user, and sets `NODE_ENV=production`. The base image is `node:22.23.4-bookworm-slim`, pinned by digest.

- **API** (`apps/api/Dockerfile`): `prisma generate && tsup`, then `pnpm deploy --legacy --prod`. On start the container runs `prisma migrate deploy` and then `node dist/main.js`, so an empty database gets its schema before the first request. The HEALTHCHECK passes only when `GET /v1/health` returns 200 and `"db":true`. Secrets (`DATABASE_URL`, `ANTHROPIC_API_KEY`) are runtime env only; nothing is baked into the image.
- **Web** (`apps/web/Dockerfile`): `ARG API_URL` (default `http://api:3001`) is exported before `next build`, because the `/v1/*` rewrite is written into `.next/routes-manifest.json` at build time. To point the image at a different API, rebuild it. The runtime runs `next start -p 3000` from a `pnpm deploy --prod` copy plus `.next`.

Build one image by hand: `docker build -f apps/api/Dockerfile -t cq-api .` (from the repo root).

## Notes

- `prisma` is a devDependency of `@cq/api`. The API image links the copy that pnpm installs as the peer of `@prisma/client`. Moving `prisma` to `dependencies` makes that step a no-op.
- The pruned web `node_modules` holds both the glibc and the musl `@next/swc` binaries (~95 MB each). Trimming them is a possible later optimisation.
