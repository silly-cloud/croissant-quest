# GitHub settings checklist (owner clicks these; the agent cannot change repo settings)

What I could read (2026-10-24, GitHub MCP `list_branches`): **every branch reports `protected: false`, including `main`**. `main` has no `.github/` directory (CI exists only on `claude/nest-next-rebuild`). I could not read rulesets, Actions permissions, secret scanning, Dependabot or signed-commit settings: the tools available here do not expose repository settings. Everything below marked "check" is UNVERIFIED.

## 0. One command (from your own machine, logged in with `gh auth login` as an admin of the repo)
```bash
gh api -X POST repos/silly-cloud/croissant-quest/rulesets --input - <<'JSON'
{"name":"protect-main","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["~DEFAULT_BRANCH"],"exclude":[]}},
 "rules":[{"type":"deletion"},{"type":"non_fast_forward"},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":false,
   "required_status_checks":[{"context":"check"}]}}]}
JSON
```
Checked from this session: `GET /rulesets` = `[]` (no rulesets yet); the `POST` above is refused here by the session's proxy (403), so it must be run by you. Add "Require a pull request" in the UI afterwards if you want it (no approval count is needed for a solo repo).

## 1. Protect `main` (Settings → Rules → Rulesets → New branch ruleset)
- [ ] Target: `main` (Include default branch). Enforcement: **Active**.
- [ ] Restrict deletions.
- [ ] Block force pushes.
- [ ] Require a pull request before merging (1 approval is optional for a solo repo; "Require conversation resolution" on).
- [ ] Require status checks to pass: add the CI job **`check`** (from `.github/workflows/ci.yml`; it appears in the list only after it has run once on GitHub). Tick "Require branches to be up to date".
- [ ] Optional: Require signed commits (only if you sign locally; agent commits in this repo are not signed).
- [ ] Optional: Require linear history (pick squash merges if you enable it).

## 2. Actions (Settings → Actions → General)
- [ ] Workflow permissions: **Read repository contents** (the workflow also declares `permissions: contents: read`).
- [ ] Do not allow Actions to create or approve pull requests.
- [ ] Fork PR workflows: require approval for first-time contributors.

## 3. Security (Settings → Code security)
- [ ] Secret scanning: on. Push protection: on.
- [ ] Dependabot alerts: on. Dependabot security updates: on.
- [ ] Optional: add `.github/dependabot.yml` (npm weekly, github-actions weekly) — an agent can add this file on request.
- [ ] Private vulnerability reporting: on.

## 4. General
- [ ] Default branch: `main`. Pull requests: allow squash merge (and/or merge commits); "Automatically delete head branches" OFF (the owner keeps branches).
- [ ] Optional: CODEOWNERS file (`* @silly-cloud`) so every PR asks you for review.
