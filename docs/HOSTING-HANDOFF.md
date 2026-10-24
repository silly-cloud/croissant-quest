# Hosting hand-off (for the win-lin session on the owner's ops box)

Owner: Viram (silly-cloud). Server: "crossaint-quest", i-017d41719b40a1f04, 100.56.246.74 (us-east-1a, t3.medium, Ubuntu 24.04), account 907620281516, SG sg-05c6dc525c5ef84c4 (SSH only from the owner's IPs).
Goal: run Croissant Quest publicly over HTTPS on that server and **leave it running** (personal server, no planned shutdown). Shut down early only on clear abuse, and say so.

## What it is

- `apps/web` frontend (Next.js, :3000) forwards `/v1/*` to `apps/api` backend (NestJS + Prisma, :3001); Postgres 16. `API_URL` is baked in at web build time.
- API runs `prisma migrate deploy` at container start. Health: `GET /v1/health` -> `{"ok":true,"db":true}`.
- Read first: `infra/README.md`, `docs/DEMO-HOSTING.md`.
- Branch: `main` once PR #3 is merged, else `claude/nest-next-rebuild`.

## Rules

1. **Never set `ANTHROPIC_API_KEY`.** The coach falls back to local rounds without it.
2. HTTPS is required for saves (device cookie is `Secure` because compose sets `NODE_ENV=production`). Easiest: Caddy with `https://100-56-246-74.sslip.io` (automatic Let's Encrypt; needs inbound 80 and 443). If you use plain http, set `COOKIE_SECURE=false` on the api and report it.
3. `WEB_ORIGIN` must equal the public URL exactly (e.g. `https://100-56-246-74.sslip.io`), or browser saves get 403 `bad_origin`.
4. Public: only 80/443. Never open 3001 or 5432. Prefer publishing the api as `127.0.0.1:3001:3001` on the server.
5. `POSTGRES_PASSWORD` in `infra/.env`: random, generated on the server; never in chat, logs or git.
6. These images have never been built with a real Docker daemon. If a build step fails, keep a local workaround if you must, but report the exact error so the repo can be fixed.

## Steps

```bash
# Docker + compose plugin, then:
git clone https://github.com/silly-cloud/croissant-quest && cd croissant-quest && git checkout main   # or claude/nest-next-rebuild
cp infra/.env.example infra/.env   # set POSTGRES_PASSWORD (random), WEB_ORIGIN=https://<host>, leave ANTHROPIC_API_KEY empty
docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d
docker compose -f infra/docker-compose.yml --env-file infra/.env ps     # api healthy
curl -s localhost:3001/v1/health
# Caddyfile:  <host> { reverse_proxy localhost:3000 }   ; open 80/443 in the SG
```

## Smoke test through the public URL

- `GET /` 200; `GET /v1/health` -> `{"ok":true,"db":true}`.
- `GET /v1/progress` sets `cq_device`; `PUT /v1/progress` (Content-Type: application/json, Origin: https://<host>, If-Match: <version>) -> 200; reload returns the saved state.
- Same PUT with `Origin: https://evil.example` -> 403.
- `POST /v1/coach/round` -> `{"fallback":true,...}`.
- Play one round in a browser if you can.

## Report to the owner (and, if messaging works, to session_01FoGVyzUPA8GqEu8peV58Gb)

Public URL; "running, no planned shutdown"; `docker compose up --build` result (or first failing step + error); smoke-test outputs; anything changed vs repo defaults; anything the owner must do. No secrets.
