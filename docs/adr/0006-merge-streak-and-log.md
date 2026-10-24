# 0006 Merge semantics: streak with last, log union, bounded saves
Status: accepted (amends 0002 merge rules and 0004 device creation). Owner-approved.

Decisions in `mergeStates` / `normState` (`packages/shared/src/state.ts`):
- `streak` and `last` are one fact. Both come from the copy with the later `last` (ISO date string compare; a null `last` loses).
  Equal `last`: the larger `streak`. Taking them separately (max streak, newer ts `last`) paired a streak with a date it never belonged to.
- `log` is the union of both copies by `(at, q)`, sorted by `at`, newest 500 kept locally (`normState` and merge), newest 120 stored.
  Two devices that each answered questions no longer lose each other's entries.
- `wrong`, `feel`, `feelLog`, `calib` stay newer-`ts`-wins. `wrong` is deliberately NOT unioned: a mistake the learner has cleared on one
  device would come back from the other. Cost: answers wrong on the older copy only are forgotten. Accepted.
- Counters (`xp`, `cro`, `rounds`, `streak`) are clamped to 1_000_000_000, so the `xp`/`streak` columns always equal the state.
- Growth bounds: `crowns` keys must be topic ids, `seen`/`wrong` keys must be bank qids (the API always passes them), keys <= 400 chars,
  `seen`/`wrong` <= 1000 keys, `crowns`/`hist` <= 100. Without `knownQids` only the length and count caps apply.
- Server clock wins: an incoming `ts` is clamped to `now + 5 min`; a missing or zero `ts` is stored as server time.

Identity (amends 0004): only `GET /v1/progress` creates a User and sets the cookie. `PUT /v1/progress` without a valid cookie is
`401 {error:"no_device"}`; coach routes look the device up read-only (unknown = anonymous, limited by client IP) and never create users;
health and questions never touch users. Clients must GET progress first and wait for it before any PUT.
