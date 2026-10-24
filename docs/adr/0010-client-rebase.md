# 0010 Client-side rebase of unsynced progress (fixes AUD-01)

Status: accepted (orchestrator decision under the owner's pre-approval). Amends 0002 (what the client does on 409) and 0006 (merge of a stale copy).

## Problem

`mergeStates` merges two copies field by field (max for counters, newer-`ts` copy for `wrong`). That is right only for one linear
history. Two tabs, or a device that played offline, each add to the same base: max keeps one side's increments and drops the
other's. Red team K-1/K-2: two tabs xp 39 + 10 -> 39 and both misses gone; 24-33% of xp lost over 3 seeded 200-step runs.

## Decision

`rebase(server, base, local)` in `packages/shared/src/rebase.ts`. The client keeps `base`, the server copy it last synced with,
next to its own copy. On a 409 (or any fresh server copy) it replays what it did since `base` onto the server copy:

- `xp`, `cro`, `rounds`, every `seen[q]`, every `hist[t][0..1]`: server + max(0, local - base).
- `crowns[t]` are levels: max(server, local) when the client raised it since base, else server.
- `wrong[q]`: a key the client changed since base takes the client's value (deleted if it cleared it); other keys keep the server's.
- `log`: server entries plus the client's entries not in base, union by `(at, q)`. `feelLog`: same by `at`, newest 20.
  `feel`/`calib`: the client's if it changed them since base, else the server's.
- `last`/`streak`: the pair with the later `last`, equal -> larger streak (as 0006). `ts`: max. Result goes through `normState`.

The server is unchanged: compare-and-swap on `version` plus `mergeStates` on PUT. Because the client always sends a copy already
rebased on the server's current version, the max in `mergeStates` no longer drops anything.

Why not a server CRDT (per-device G-counters, per-key LWW with tombstones, suggested by K-1/K-2): it changes the stored schema,
the API contract and the `xp`/`streak` columns, and needs a migration of every save. The server already serialises writes
(If-Match / 409), so the client holds all the information needed to replay its own changes; a pure function of three copies is
small, testable in `packages/shared`, and needs no new storage on the server.

## Client contract (apps/web)

1. Persist `base` with the save (e.g. localStorage `cq.base` next to the state, plus its `version`). Without it after a reload,
   use the last server copy you know; never use the local copy as `base` (that would discard the unsynced work).
2. On GET: `local = rebase(server, base, local)`, then `base = server`, `version = server version`.
3. Before PUT, remember `sent = local`. On 200 with body `S`: `local = rebase(S, sent, local)` (keeps answers made during the
   request), `base = S`, `version` = the new version.
4. On 409 with body `S`: `local = rebase(S, base, local)`, `base = S`, `version` = S's version, then retry the PUT.
5. Update `base` only from a server response, and only together with `version`. Never from local edits or another tab.

## Tests

`packages/shared/test/rebase.test.ts`: one test per field rule, purity, idempotence (`rebase(s, x, x) == normState(s)`), never
lowering a server count; and a seeded property test (seeds 7, 42, 1234 x 200 steps) with tabs A, B and an offline device D against
a fake CAS server: no counter ever goes down, final xp/cro/rounds/seen/hist equal the sum of all increments, and every device ends
on the server copy. The same harness with the old max-merge loses about half the xp, so the oracle is real.

## Not covered

- Concurrent edits of one `wrong` key: the tab that syncs last wins that key. A miss made while another tab cleared the same
  question can vanish, and a stale tab that answered right once after seeing 2 misses keeps 1 after another tab cleared both
  (pinned as `[known limit]` tests). Counts in `wrong` are not summed across tabs.
- Streak across devices (K-6): a `(last, streak)` pair still cannot say "days played on the other device".
- Two devices without a shared identity (ADR 0004): each device is its own anonymous user, so nothing is merged between them.
- Clock skew on `ts` (K-5) and the `wrong` cap/`knownQids` filtering are unchanged; `rebase` does not take `knownQids`.
