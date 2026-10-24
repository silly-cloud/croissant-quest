# 0002 Progress storage: jsonb with indexed counters
Status: accepted. Table `Progress(userId pk/fk, state jsonb, ts bigint, version int, xp int, streak int)`.
Why: the save document is already one object (`S`); normalising wrong/hist/seen into tables buys nothing for one user and makes the merge harder.
`xp` and `streak` are columns for cheap queries and leaderboards later. Merge runs in `packages/shared.mergeState`, inside a transaction guarded by `version`
(`PUT /v1/progress` with `If-Match: <version>`; mismatch → 409 with the server copy, the client merges and retries).
Not covered: multiple users, auth, history/audit of past saves. Rollback: `prisma migrate resolve` + drop table (documented in apps/api/README).
