# Make the hosted site private (password in front of everything)

Caddy asks for a username and password before it serves anything: the pages and every `/v1/*` call. After one login the browser sends the credentials automatically on the same site, so the game works normally. Nobody without the password can open it or spend coach calls.

## Steps (on the server)

1. Make a password hash (the plain password never goes into a file):
   ```bash
   caddy hash-password            # type the password twice; copy the $2a$... hash it prints
   ```
2. Edit the Caddyfile (usually `/etc/caddy/Caddyfile`) so the site block reads:
   ```caddy
   <your-host> {
       basic_auth {
           <username> <the $2a$... hash>
       }
       reverse_proxy localhost:3000
   }
   ```
   (Caddy older than 2.8 spells the directive `basicauth`.)
3. Check and reload:
   ```bash
   caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
4. Verify from any other machine (`H` = your site URL):
   ```bash
   curl -s -o /dev/null -w "%{http_code}\n" $H/                          # 401 without a password
   curl -s -o /dev/null -w "%{http_code}\n" -u <username> $H/v1/health   # 200 with it (prompts for the password)
   ```
   Then open the site in a browser, log in once, play a round, reload: progress is kept.

## Notes

- Keep the password out of chats, issues and the repo. To change it, repeat steps 1-3. To make the site public again, remove the `basic_auth` block and reload.
- The containers' own health checks talk to the services directly, not through Caddy, so they are unaffected.
- With the site private, the five-minute coach test (`docs/COACH-KEY-TEST.md`) only spends money when you use it; keep the Console spend limit anyway.
