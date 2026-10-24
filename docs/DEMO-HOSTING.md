# Demo hosting (temporary, a few hours)

The cloud session that built this could not open a public tunnel: its network policy refuses the cloudflared download (HTTP 403 via the egress proxy) and does not reach `api.trycloudflare.com`; no `ngrok`/`ssh` binaries are installed. Allowing `github.com`, `objects.githubusercontent.com`, `api.trycloudflare.com` and `*.argotunnel.com` in the environment's Network access settings may unblock it (Cloudflare also uses port 7844, which a web-only proxy may not carry). Until then, run it from your own machine.

**Never set `ANTHROPIC_API_KEY` for a public demo.** Without it the coach falls back to local rounds and the game still works.

## Option A: your machine + a tunnel (about 10 minutes)
Prerequisites: Node 22, pnpm 10 (`corepack enable`), Docker (for Postgres) or a local Postgres 16, and `cloudflared` (or `ngrok`).
```bash
git clone https://github.com/silly-cloud/croissant-quest && cd croissant-quest
git checkout claude/nest-next-rebuild        # or main once PR #3 is merged
pnpm install --frozen-lockfile

# 1. Postgres on localhost only
docker run -d --name cq-db -e POSTGRES_USER=cq -e POSTGRES_PASSWORD=change-me -e POSTGRES_DB=cq \
  -p 127.0.0.1:5432:5432 postgres:16
export DATABASE_URL=postgresql://cq:change-me@localhost:5432/cq

# 2. API (port 3001, not exposed)
pnpm --filter @cq/api db:migrate && pnpm --filter @cq/api db:seed
pnpm --filter @cq/api build
TUNNEL_URL=https://YOUR-TUNNEL-HOST          # fill in after step 4, then restart the API
WEB_ORIGIN=$TUNNEL_URL COOKIE_SECURE=true PORT=3001 pnpm --filter @cq/api start &

# 3. Web (port 3000). API_URL is baked in at build time.
API_URL=http://localhost:3001 pnpm --filter @cq/web build
pnpm --filter @cq/web start &

# 4. Expose ONLY the web port
cloudflared tunnel --url http://localhost:3000     # prints https://<random>.trycloudflare.com
#   or: ngrok http 3000
```
`WEB_ORIGIN` must equal the public URL exactly (scheme + host), or browser saves get 403 `bad_origin`. Restart the API after setting it. Stop everything with `kill %1 %2` and `docker rm -f cq-db` when the demo ends.

## Option B: free managed tiers (check each pricing page first; terms change)
| Part | Service | Setting |
|---|---|---|
| Postgres | Neon (free) | copy its connection string to `DATABASE_URL`; expect a cold start after idle |
| API | Render free web service, Docker, `apps/api/Dockerfile`, context repo root | env `DATABASE_URL`, `WEB_ORIGIN=https://<web host>`, `NODE_ENV=production`; no `ANTHROPIC_API_KEY`. Sleeps after ~15 min idle. The image runs migrations at start. |
| Web | Render (Docker, `apps/web/Dockerfile`) or Vercel | build arg / env `API_URL=https://<api host>` **before the build**. On Vercel set root `apps/web`, build `pnpm --filter @cq/web build`. |
Keep the browser on the web host only (the web app forwards `/v1/*`), otherwise the device cookie is cross-site and saves fail. No account is created for you by this repo or its agents.

## For AWS later
`docker compose -f infra/docker-compose.yml --env-file infra/.env up --build -d` on the server (set `POSTGRES_PASSWORD`, `WEB_ORIGIN` = your domain), put a TLS proxy (Caddy/ALB) in front of port 3000 only. Postgres is bound to 127.0.0.1. See infra/README.md.
