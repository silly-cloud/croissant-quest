import { normState, type FeelEntry, type LogEntry, type State } from "./state.js";

/** What the client added to a count since `base` (never negative: a count the client did not raise adds nothing). */
const added = (local: number | undefined, base: number | undefined) => Math.max(0, (local ?? 0) - (base ?? 0));

const addCounts = (server: Record<string, number>, base: Record<string, number>, local: Record<string, number>) => {
  const r = { ...server };
  for (const k of Object.keys(local)) {
    const d = added(local[k], base[k]);
    if (d) r[k] = (r[k] ?? 0) + d;
  }
  return r;
};

const logKey = (e: LogEntry) => `${e.at}|${e.q}`;

/**
 * Replay the client's changes since its last sync onto a fresh server copy (ADR 0010, fixes AUD-01).
 *
 * - `server`: the server's current copy (a GET, a 409 body, or a 200 body).
 * - `base`: the copy the client last synced with: the server state it last received.
 * - `local`: the client's current copy (base plus whatever it played since).
 *
 * Counters, `seen` and `hist` add the client's increments to the server's total, so progress made
 * on two tabs or an offline device is summed, not maxed. `wrong` keys the client touched take the
 * client's value; untouched keys keep the server's. Pure: no argument is mutated.
 * Assumes `server` descends from `base` (the server never lowers a counter), so
 * `rebase(server, x, x)` is `normState(server)`.
 */
export function rebase(server: State, base: State, local: State): State {
  const r: State = structuredClone(server);

  r.xp = server.xp + added(local.xp, base.xp);
  r.cro = server.cro + added(local.cro, base.cro);
  r.rounds = server.rounds + added(local.rounds, base.rounds);

  // crowns are levels (0..5), not counts: a raised level is kept, never added
  for (const t of Object.keys(local.crowns))
    if ((local.crowns[t] ?? 0) > (base.crowns[t] ?? 0)) r.crowns[t] = Math.max(server.crowns[t] ?? 0, local.crowns[t]!);

  r.seen = addCounts(server.seen, base.seen, local.seen);
  r.hist = structuredClone(server.hist);
  for (const t of Object.keys(local.hist)) {
    const l = local.hist[t]!, b = base.hist[t] ?? [0, 0], s = r.hist[t] ?? [0, 0];
    const d0 = added(l[0], b[0]), d1 = added(l[1], b[1]);
    if (d0 || d1) r.hist[t] = [s[0] + d0, s[1] + d1];
  }

  // wrong: the client's value for every key it changed (deleted = cleared, so never resurrected), else the server's
  r.wrong = { ...server.wrong };
  for (const q of new Set([...Object.keys(base.wrong), ...Object.keys(local.wrong)])) {
    const l = Object.hasOwn(local.wrong, q) ? local.wrong[q] : undefined;
    const b = Object.hasOwn(base.wrong, q) ? base.wrong[q] : undefined;
    if (l === b) continue;
    if (l === undefined || l <= 0) delete r.wrong[q];
    else r.wrong[q] = l;
  }

  // log: the server's entries plus the ones the client added since base, union by (at, q)
  const baseLog = new Set(base.log.map(logKey));
  const byKey = new Map<string, LogEntry>();
  for (const e of server.log) byKey.set(logKey(e), e);
  for (const e of local.log) if (!baseLog.has(logKey(e))) byKey.set(logKey(e), e);
  r.log = [...byKey.values()].sort((x, y) => x.at - y.at);

  const baseFeel = new Set(base.feelLog.map((e) => e.at));
  const byAt = new Map<unknown, FeelEntry>();
  for (const e of server.feelLog) byAt.set(e.at, e);
  for (const e of local.feelLog) if (!baseFeel.has(e.at)) byAt.set(e.at, e);
  r.feelLog = [...byAt.values()].sort((x, y) => Number(x.at) - Number(y.at)).slice(-20);
  r.feel = local.feel !== base.feel ? local.feel : server.feel;
  r.calib = local.calib !== base.calib ? local.calib : server.calib;

  // last and streak are one fact (ADR 0006): the pair with the later `last`, equal -> the larger streak
  const sl = server.last ?? "", ll = local.last ?? "";
  if (ll > sl) [r.last, r.streak] = [local.last, local.streak];
  else if (ll === sl) r.streak = Math.max(server.streak, local.streak);

  r.ts = Math.max(server.ts, local.ts);
  return normState(r);
}
