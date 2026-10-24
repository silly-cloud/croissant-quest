# What no lane could test

Each item gives what was not tested, why, and what would verify it. Lane IDs are in brackets.

## 1. Credentials and GitHub settings
| Item | Why | What would verify it |
|---|---|---|
| Rulesets on main (only the classic `protected:false` flag was seen) [G] | gh token invalid; the MCP tools expose only `protected` | Owner: Settings > Rules, or `gh api repos/silly-cloud/croissant-quest/rulesets` with a valid token |
| Signed commits, secret scanning, push protection, Dependabot alerts, merge types, auto-delete [G] | No working token | Owner screenshot of Settings > Code security and Branches |
| Default GITHUB_TOKEN permissions for Actions [F, G, H] | `gh api …/actions/permissions/workflow` -> 403 from the proxy | Owner: Settings > Actions > Workflow permissions; or the `permissions` block from FIX-02 makes it moot |
| CI has never run on GitHub [F, I] | Only simulated locally (ci-sim.sh) | First green run of ci.yml on the PR, after FIX-01 and FIX-02 |
| Follow-up tickets 17/18/20/22 from the Lane 2 review; ADR 0004 export/import follow-up [I] | No ticket store in the repo | The owner names where tickets live, or they are created |
| Whether skills were really invoked (SKILLS-MAP "used" claims) [I] | No session logs, only artifacts | Session transcripts |
| Brief and plan content (ADR 0001 "deviation none", ADR 0004 "any number of devices") [I] | The brief is not in the repo; the plan is outside the repo | Commit the brief or plan, or the owner confirms |
| AUDIT-REPORT "script byte-identical to live artifact" [I] | No artifact access | Diff against the live artifact |

## 2. Docker daemon
| Item | Why | What would verify it |
|---|---|---|
| Any container build or run; compose `up --build` [F, G, H] | Daemon socket missing, and both Dockerfiles do not exist | FIX-14 acceptance on a host with Docker |
| Next rewrites fixed at build inside an image (AUD-27) [F, H] | Inferred from the worktree routes-manifest | Build the web image with and without `ARG API_URL`, then `curl /v1/health` through it |
| api healthcheck / migrate on start (AUD-26), COOKIE_SECURE over http on a LAN host (AUD-28) [F] | No stack running | Compose on a VM reached by IP; check that the cookie is stored |
| TRUST_PROXY_HOPS behind the Next proxy, and what `req.ip` the API sees (AUD-33) [F, H, D] | Not run behind a real proxy | Compose stack: log `req.ip` for two client IPs through web, with hops 0 and 1 |
| `pnpm install --prod` in a real Docker stage (AUD-29) [G] | Reproduced only in a git-archive tree with no .git | `docker build` of the api image |
| Docker user and image hardening [H] | No Dockerfile exists | Review after FIX-14 |

## 3. Real Anthropic API
| Item | Why | What would verify it |
|---|---|---|
| Real Messages API behaviour (auth header, errors, timing) [D, K] | No key; a local stub via ANTHROPIC_BASE_URL was used | One smoke run with a real key in a sandbox account |
| Whether the model follows a 60-char learner-text injection, and what it outputs [H, K] | No real key | Red-team prompts against the real model; check the explain output stays on topic |
| Dollar cost of the AUD-10 budget drain [H] | Pricing for `claude-sonnet-5-5` not looked up | Pricing page x 120/min x 2500 output tokens |
| Valid-row rate of real coach rounds under the tightened validator (FIX-17) [B] | Only crafted rows were tested | 20 real rounds; count rejected rows by reason |

## 4. Real browsers, screen readers, phones
| Item | Why | What would verify it |
|---|---|---|
| Screen readers: "Not quite. N hearts left" is announced while the modal dialog opens (content outside a modal is inert) [E] | No screen reader | NVDA/VoiceOver run of a wrong answer |
| Real phones, the on-screen keyboard covering the type box, iOS Safari `<dialog>` [E] | Chromium only | BrowserStack or a device: iPhone SE and a small Android |
| HUD width with the Fredoka font loaded (AUD-08 may be worse) [E] | Fonts blocked in every run | Playwright with the fonts allowed |
| Safari Secure cookie on http://localhost [F] | No Safari | Safari run against the compose stack |
| Sound output, reduced-motion animations stop [A] | No audio device; nothing asserts it | Manual check, or a Playwright assertion on computed animation |
| Real multi-tab behaviour (storage events, cookie races on the first visit) [D, K] | Simulated with the GameStore class and in-memory storage; D did not run the two-cookie first-visit race | Playwright with two pages in one context against the real API |
| A browser `<input>` accepting NUL (K-4 NUL path) [K] | The emoji path is reproduced; NUL is not | Playwright paste of `\u0000` |
| Streak in a non-UTC timezone in the browser [A] | vm and Chromium ran in the container zone | Playwright `timezoneId: "Asia/Kolkata"` round over midnight |
| Windows and macOS checkouts (CRLF, jq missing) [G] | No such host | Windows CI runner: run test-guardrails.sh |

## 5. TLA+ / model checking
| Item | Why | What would verify it |
|---|---|---|
| Statechart rules (Game screen + Round + Sync regions, 5 rules) [E] | TLC (tla2tools.jar) not installed and nothing downloaded; reasoned by hand only | Encode statechart.mmd in TLA+/PlusCal and run TLC on the 5 rules |
| Merge convergence across N copies (relevant to FIX-22) [K] | Random simulation only (3 seeds x 200 steps) | A TLA+ or property-based model of mergeStates with N writers |

## 6. Web against the real API
| Item | Why | What would verify it |
|---|---|---|
| Cookie through the Next rewrite, Secure flag, 401/429 bodies [E, A] | e2e used `fake-api.mjs` (one global cookie flag) | Playwright e2e with the real api + cq_test after FIX-01 |
| E-web-4 API side (a User per GET when the cookie never sticks) [E] | Web side proven by a unit probe; API side by reading plus D/H/K probes | The same e2e with cookies blocked: count User rows |
| `GET /v1/questions` shape accepted by the web store [A] | The fake API returns the same shape; not run against the real one | The same e2e |
| A-9/E-web-1 inside the real worktree (`tsc`/`next build`) [A, C] | Building writes into a read-only worktree | FIX-01 acceptance |
| Next consumption of TS packages (transpilePackages + extensionAlias) and the bundle-size cost of @cq/content in the browser [C] | Not built in the worktree | `next build` stats after FIX-01 |
| H-6 behaviour through the real Next proxy (X-Forwarded-For) [H] | Not rebuilt against the probe API | Same as section 2 |

## 7. French authoritative sources
| Item | Why | What would verify it |
|---|---|---|
| Canonical Indic glyph for French /z/ and /ʒ/ (Hindi ज़ vs झ़; Gujarati જ઼ vs ઝ઼) [B] | From memory only; no source cited | A native Hindi and Gujarati reader, or a published transliteration standard (FIX-18 decision) |
| *Il fait du vent* as an equal alternative to *Il y a du vent* [B] | Register judgment | A cited grammar (e.g. Grevisse, Bescherelle) or a native teacher |
| Negation of *jouer de* (*pas du piano* vs *pas de piano*) [B] | No bank item yet | The same sources, before the coach is allowed to write such items |
| All grammar judgments in B-french [B] | No web search; standard A1 knowledge without citations | Spot-check by a French teacher of the 15 B findings |

## 8. Multi-process API and scale
| Item | Why | What would verify it |
|---|---|---|
| The in-memory rate limiter across processes (documented as per process) [D] | Single process only | Two API processes behind one proxy: show that the limits double |
| Limiter memory and eviction under real IPv6 traffic (AUD-32) [D] | Demo with cap 3 only | Load test with randomised /128 addresses |
| pg pool and statement timeout defaults of @prisma/adapter-pg [H] | Not checked | Slow-query test (`pg_sleep`) through the API |
| Server-side day boundaries [K] | The server never computes a day | Nothing to test unless FIX-16 adds a server today+1 clamp; then a TZ test at UTC+14 |

## 9. Other
| Item | Why | What would verify it |
|---|---|---|
| What `CLAUDE_PROJECT_DIR` worktree subagents get (the hook may be missing, rc 127, fail open) [G] | Could not inspect a live subagent's environment | Run a subagent in a worktree and attempt `git push -f` against a scratch remote |
| Claude Code hook timeout value and behaviour on timeout (AUD-60, 72.8 s case) [G] | Docs only, not reproduced | A 5000-segment command in a live session |
| `HUSKY=0` and husky no-.git behaviour as stated in ADR 0007:15 [I] | Not exercised by I (G showed `HUSKY=0` skips hooks) | `HUSKY=0 git commit` in a scratch clone with Husky on |
| Dependency CVEs: D listed them as unverified (offline); H ran `pnpm audit` (registry reachable): 1 high, multer, unreachable [D, H] | Resolved by H | Keep `pnpm audit --prod` in CI |
| Whether J-7/C-11 unused exports are used by the final web app [J, C] | Web is a work in progress | grep after FIX-01 |
| Contrast numbers in AUDIT-REPORT other than 4.95:1 [I] | Not recomputed by I (E recomputed the web tokens) | E's contrast.mjs against the final tokens |
