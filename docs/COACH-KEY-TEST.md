# Five-minute coach test with a real API key

Goal: try the Claude-written questions on the hosted app for a few minutes, with a hard spending cap, then switch the coach off again. Use an **Anthropic API key** (`sk-ant-api…`) from the Console. Do **not** use Claude Code's `.credentials.json`: it holds subscription sign-in tokens, not an API key; the app cannot use them and using them outside Claude Code breaks Anthropic's terms.

## 1. Make a capped, throwaway key (Anthropic Console)

1. https://console.anthropic.com → **Settings → Workspaces → Create workspace**, e.g. `croissant-quest-test`.
2. In that workspace set a **spend limit** (e.g. $5/month). This is the hard ceiling if anything goes wrong.
3. **API keys → Create key** in that workspace. Copy it once; never paste it into a chat, an issue, a commit or a log.

## 2. Turn the coach on (on the server, over SSH)

```bash
cd ~/croissant-quest
nano infra/.env                       # ANTHROPIC_API_KEY=sk-ant-api...
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d api
docker compose -f infra/docker-compose.yml logs api --tail 20 | grep -i coach   # expect: coach enabled
```

Only the API container restarts; saved progress is kept.

## 3. Test (about 5 minutes)

- In the browser: open the site, press **Fresh questions** (or **Drill**). Claude-written questions should appear (no "Repeat" labels, no local-round notice).
- Or with curl (`H` = your site URL):

```bash
J=$(mktemp); curl -s -c $J -o /dev/null $H/v1/progress
curl -s -b $J -X POST -H "Content-Type: application/json" -H "Origin: $H" -d '{"n":4}' $H/v1/coach/round | head -c 300; echo
```

Expect `{"fallback":false,"questions":[...]}`. `{"fallback":true,"reason":"error"}` means the upstream call failed: check `docker compose ... logs api` for the status code (for example a model id the account cannot use; the id lives in `apps/api/src/modules/coach/coach.config.ts`).

- Limits stay on while the key is set (ADR 0009): device required, 10/min and 50/day per device, 20/min per IP, 120/min and 500/day in total.

## 4. Switch it off again

```bash
nano infra/.env                       # ANTHROPIC_API_KEY=   (empty)
docker compose -f infra/docker-compose.yml --env-file infra/.env up -d api
```

Then in the Console **delete the key** (or disable it) and check **Usage** for the workspace. The app keeps working with local rounds.
