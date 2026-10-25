import { describe, expect, it } from "vitest";
import { BANK, TAG, qid, type Question } from "@cq/content";
import {
  emptyState, mergeStates, normState, noteAnswer, rebase, scoreRound, xpFor, type State,
} from "../src/index.js";

const s = (o: Partial<State> = {}): State => normState({ ...emptyState(), ...o });
const TAGS = Object.keys(TAG);
const [Q0, Q1, Q2] = BANK.map(qid) as [string, string, string];
const [M, N] = TAGS as [string, string];

describe("rebase: field rules", () => {
  it("counters: server + what the client added since base (two tabs 39 + 10 = 49, K-1)", () => {
    const base = s({ xp: 0, cro: 1, rounds: 2 });
    const server = s({ xp: 39, cro: 1, rounds: 3 });
    const local = s({ xp: 10, cro: 2, rounds: 3 });
    const r = rebase(server, base, local);
    expect([r.xp, r.cro, r.rounds]).toEqual([49, 2, 4]);
  });
  it("counters: a client copy below its base adds nothing and never lowers the server", () => {
    const r = rebase(s({ xp: 50, rounds: 5 }), s({ xp: 40, rounds: 4 }), s({ xp: 0, rounds: 0 }));
    expect([r.xp, r.rounds]).toEqual([50, 5]);
  });
  it("crowns are levels: max(server, local) when the client raised it, else the server's", () => {
    const base = s({ crowns: { 6: 1, 7: 2 } });
    const server = s({ crowns: { 6: 2, 7: 4 } });
    const local = s({ crowns: { 6: 3, 7: 2 } });
    const r = rebase(server, base, local);
    expect([r.crowns[6], r.crowns[7]]).toEqual([3, 4]);
    expect(rebase(s({ crowns: { 6: 4 } }), s({ crowns: { 6: 1 } }), s({ crowns: { 6: 2 } })).crowns[6]).toBe(4);
  });
  it("seen and hist add per-key increments", () => {
    const base = s({ seen: { [Q0]: 1 }, hist: { [M]: [1, 1] } });
    const server = s({ seen: { [Q0]: 2, [Q1]: 1 }, hist: { [M]: [2, 1], [N]: [0, 1] } });
    const local = s({ seen: { [Q0]: 2, [Q2]: 1 }, hist: { [M]: [1, 3], [N]: [1, 0] } });
    const r = rebase(server, base, local);
    expect(r.seen).toEqual({ [Q0]: 3, [Q1]: 1, [Q2]: 1 });
    expect(r.hist).toEqual({ [M]: [2, 3], [N]: [1, 1] });
  });
  it("wrong: keys the client changed take its value, a cleared key stays cleared, others keep the server's (K-2)", () => {
    const base = s({ wrong: { [Q0]: 1, [Q1]: 2 } });
    const server = s({ wrong: { [Q0]: 1, [Q1]: 2, [Q2]: 1 } }); // another tab missed Q2
    const local = s({ wrong: { [Q1]: 3 } }); // this tab cleared Q0 and missed Q1 again
    expect(rebase(server, base, local).wrong).toEqual({ [Q1]: 3, [Q2]: 1 });
    // the stale tab answered something unrelated: the other tab's misses survive (was {} before)
    expect(rebase(s({ wrong: { [Q0]: 1, [Q1]: 1 } }), s(), s()).wrong).toEqual({ [Q0]: 1, [Q1]: 1 });
    // a key the client cleared is not brought back by a server copy that still has it
    expect(rebase(s({ wrong: { [Q0]: 4 } }), s({ wrong: { [Q0]: 4 } }), s()).wrong).toEqual({});
  });
  it("log: union by (at, q) of the server's and the client's new entries; trimmed entries are not re-added", () => {
    const e = (at: number, q = Q0) => ({ q, t: 6, tag: M, gave: "x", at });
    const base = s({ log: [e(1), e(2)] });
    const server = s({ log: [e(2), e(3)] }); // server dropped e(1)
    const local = s({ log: [e(1), e(2), e(4), e(4, Q1)] });
    expect(rebase(server, base, local).log.map((x) => `${x.at}${x.q === Q1 ? "b" : ""}`)).toEqual(["2", "3", "4", "4b"]);
  });
  it("feelLog: union by at, newest 20; feel/calib: the client's if it changed them, else the server's (K-10)", () => {
    const f = (at: number) => ({ feel: 50, mine: 50, at, r: 1 });
    const base = s({ feelLog: [f(1)], feel: 10, calib: "aligned" });
    const server = s({ feelLog: [f(1), f(2)], feel: 20, calib: "harder" });
    const local = s({ feelLog: [f(1), f(3)], feel: 10, calib: "proof" });
    const r = rebase(server, base, local);
    expect(r.feelLog.map((x) => x.at)).toEqual([1, 2, 3]);
    expect([r.feel, r.calib]).toEqual([20, "proof"]);
    const many = s({ feelLog: Array.from({ length: 20 }, (_, i) => f(i + 100)) });
    expect(rebase(many, s(), s({ feelLog: [f(500)] })).feelLog.map((x) => x.at).slice(-2)).toEqual([119, 500]);
    expect(rebase(many, s(), s({ feelLog: [f(500)] })).feelLog).toHaveLength(20);
  });
  it("last/streak: the pair with the later last; equal last -> the larger streak", () => {
    const base = s({ last: "2026-10-20", streak: 5 });
    expect(rebase(s({ last: "2026-10-21", streak: 6 }), base, s({ last: "2026-10-22", streak: 2 })))
      .toMatchObject({ last: "2026-10-22", streak: 2 });
    expect(rebase(s({ last: "2026-10-22", streak: 9 }), base, s({ last: "2026-10-21", streak: 6 })))
      .toMatchObject({ last: "2026-10-22", streak: 9 });
    expect(rebase(s({ last: "2026-10-21", streak: 3 }), base, s({ last: "2026-10-21", streak: 6 })))
      .toMatchObject({ last: "2026-10-21", streak: 6 });
  });
  it("ts is the max, and the result is normalised (caps kept)", () => {
    expect(rebase(s({ ts: 5 }), s({ ts: 1 }), s({ ts: 9 })).ts).toBe(9);
    expect(rebase(s({ xp: 999_999_999 }), s(), s({ xp: 5 })).xp).toBe(1_000_000_000);
  });
  it("[known limit, ADR 0010] concurrent edits of one wrong key: the last tab to sync wins that key", () => {
    // B cleared Q0 while A (unsynced) missed it again: whichever syncs last decides
    expect(rebase(s({ wrong: { [Q0]: 2 } }), s({ wrong: { [Q0]: 1 } }), s()).wrong).toEqual({});
    // A tab that saw 2 misses and answered right once keeps 1, even if another tab cleared both meanwhile
    expect(rebase(s(), s({ wrong: { [Q0]: 2 } }), s({ wrong: { [Q0]: 1 } })).wrong).toEqual({ [Q0]: 1 });
  });
  it("is pure: no argument is mutated", () => {
    const server = s({ xp: 3, wrong: { [Q0]: 1 }, hist: { [M]: [1, 0] } });
    const base = s(), local = s({ xp: 2, wrong: { [Q1]: 1 }, hist: { [M]: [0, 1] } });
    const copies = structuredClone([server, base, local]);
    rebase(server, base, local);
    expect([server, base, local]).toEqual(copies);
  });
});

describe("rebase: idempotence and monotonicity", () => {
  const rich = (k: number) =>
    s({
      xp: 10 * k, cro: k, rounds: 2 * k, streak: k, last: `2026-10-${10 + k}`, ts: 100 * k,
      crowns: { 6: Math.min(5, k), 7: 1 }, seen: { [Q0]: k, [Q1]: 1 }, wrong: { [Q0]: k, [Q2]: 1 },
      hist: { [M]: [k, 1] }, log: [{ q: Q0, t: 6, tag: M, gave: "g", at: k }], feel: k, calib: "more",
      feelLog: [{ feel: 1, mine: 2, at: k, r: 0 }],
    });
  it("rebase(server, local, local) == normState(server) when the client changed nothing", () => {
    for (const [sv, lc] of [[3, 1], [5, 5], [7, 2]] as const)
      expect(rebase(rich(sv), rich(lc), rich(lc))).toEqual(normState(rich(sv)));
  });
  it("never lowers any server counter, crown, seen or hist count", () => {
    let seed = 99;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const rs = () => rich(1 + Math.floor(rnd() * 5));
    for (let i = 0; i < 200; i++) {
      const server = rs(), r = rebase(server, rs(), rs());
      for (const k of ["xp", "cro", "rounds"] as const) expect(r[k]).toBeGreaterThanOrEqual(server[k]);
      for (const t of Object.keys(server.crowns)) expect(r.crowns[t]).toBeGreaterThanOrEqual(server.crowns[t]!);
      for (const q of Object.keys(server.seen)) expect(r.seen[q]).toBeGreaterThanOrEqual(server.seen[q]!);
      for (const t of Object.keys(server.hist))
        for (const j of [0, 1]) expect(r.hist[t]![j]).toBeGreaterThanOrEqual(server.hist[t]![j]!);
    }
  });
});

/* ---------- property test: two tabs + one offline device against a compare-and-swap server ---------- */

type Merge = (server: State, base: State, local: State) => State;
interface Server { state: State; version: number; known: Set<string> }
interface Resp { ok: boolean; state: State; version: number; known: Set<string> }
interface Tab {
  name: string; offline: boolean; base: State; local: State; version: number; combo: number;
  known: Set<string>; pending: { sent: State; resp: Resp } | null;
}
interface Miss { id: string; q: string; knewBefore: Set<string> }
interface Clear { id: string; q: string; knew: Set<string> }

const POOL: Question[] = BANK.filter((q) => q.t > 5 && q.tag && Object.hasOwn(TAG, q.tag)).slice(0, 12);

function simulate(seedIn: number, merge: Merge, steps = 200) {
  let seed = seedIn;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  let clock = 1_800_000_000_000, day = 0, n = 0;
  const today = () => new Date(Date.UTC(2026, 9, 1 + day)).toISOString().slice(0, 10);
  const server: Server = { state: normState(emptyState()), version: 0, known: new Set() };
  const mk = (name: string, offline = false): Tab => ({
    name, offline, base: structuredClone(server.state), local: structuredClone(server.state), version: 0,
    combo: 0, known: new Set(), pending: null,
  });
  const tabs = [mk("A"), mk("B"), mk("D", true)];
  const truth = { xp: 0, cro: 0, rounds: 0, seen: {} as Record<string, number>, hist: {} as Record<string, [number, number]> };
  const misses: Miss[] = [], clears: Clear[] = [], violations: string[] = [];
  const stats = { answers: 0, rounds: 0, syncs: 0, s409: 0 };

  const mono = (label: string, a: State, b: State) => {
    for (const k of ["xp", "cro", "rounds"] as const) if (b[k] < a[k]) violations.push(`${label} ${k} ${a[k]}->${b[k]}`);
    for (const k of Object.keys(a.seen)) if ((b.seen[k] ?? 0) < a.seen[k]!) violations.push(`${label} seen`);
    for (const k of Object.keys(a.crowns)) if ((b.crowns[k] ?? 0) < a.crowns[k]!) violations.push(`${label} crown`);
    for (const k of Object.keys(a.hist))
      for (const j of [0, 1]) if ((b.hist[k]?.[j] ?? 0) < a.hist[k]![j]!) violations.push(`${label} hist`);
  };
  const edit = (t: Tab, fn: (d: State) => void) => {
    const d = structuredClone(t.local);
    fn(d);
    d.ts = Math.max(clock, d.ts + 1); // what GameStore.update does
    t.local = d;
  };
  const put = (version: number, sent: State, known: Set<string>): Resp => {
    if (version === server.version) {
      const before = server.state;
      server.state = normState(mergeStates(server.state, normState(sent)));
      server.version++;
      for (const k of known) server.known.add(k);
      mono("server", before, server.state);
      return { ok: true, state: structuredClone(server.state), version: server.version, known: new Set(server.known) };
    }
    stats.s409++;
    return { ok: false, state: structuredClone(server.state), version: server.version, known: new Set(server.known) };
  };
  const startSync = (t: Tab) => {
    if (t.pending) return;
    const sent = structuredClone(t.local);
    t.pending = { sent, resp: put(t.version, sent, new Set(t.known)) };
  };
  /** The response arrives (the tab may have played since it sent). Returns false on a 409 (already retried). */
  const deliver = (t: Tab): boolean => {
    const p = t.pending;
    if (!p) return true;
    t.pending = null;
    const before = t.local;
    // 200: the server holds `sent`, so replay what was played since `sent`; 409: replay everything since `base`
    t.local = merge(p.resp.state, p.resp.ok ? p.sent : t.base, t.local);
    t.base = p.resp.state;
    t.version = p.resp.version;
    for (const k of p.resp.known) t.known.add(k);
    mono(`local ${t.name}`, before, t.local);
    stats.syncs++;
    if (!p.resp.ok) startSync(t);
    return p.resp.ok;
  };
  const answer = (t: Tab) => {
    const q = POOL[Math.floor(rnd() * POOL.length)]!, id = qid(q), ok = rnd() < 0.55;
    t.combo = ok ? t.combo + 1 : 0;
    const gain = ok ? xpFor(t.combo) : 0;
    edit(t, (d) => {
      noteAnswer(d, q.tag, ok);
      d.seen[id] = (d.seen[id] ?? 0) + 1;
      if (ok) {
        d.xp += gain;
        if (d.wrong[id]) {
          d.wrong[id]--;
          if (d.wrong[id]! <= 0) {
            delete d.wrong[id];
            const c = `c${n++}`;
            clears.push({ id: c, q: id, knew: new Set(t.known) });
            t.known.add(c);
          }
        }
      } else {
        d.wrong[id] = (d.wrong[id] ?? 0) + 1;
        d.log.push({ q: id, t: q.t, tag: q.tag, gave: "x", at: clock });
        const m = `m${n++}`;
        misses.push({ id: m, q: id, knewBefore: new Set(t.known) });
        t.known.add(m);
      }
    });
    truth.xp += gain;
    truth.seen[id] = (truth.seen[id] ?? 0) + 1;
    (truth.hist[q.tag] ??= [0, 0])[ok ? 0 : 1]++;
    stats.answers++;
  };
  const finish = (t: Tab) => {
    const topic = POOL[Math.floor(rnd() * POOL.length)]!.t, right = Math.floor(rnd() * 9);
    let perfect = false;
    edit(t, (d) => {
      perfect = scoreRound(d, { topic, mode: "normal", hearts: 1, right, questions: Array(8).fill({ t: topic }) }, today()).perfect;
      if (rnd() < 0.3) {
        d.feel = Math.floor(rnd() * 100);
        d.feelLog.push({ feel: d.feel, mine: 50, at: clock, r: d.rounds });
      }
    });
    truth.rounds++;
    if (perfect) truth.cro++;
    stats.rounds++;
  };

  for (let it = 0; it < steps; it++) {
    clock += 1000;
    if (rnd() < 0.03) day++;
    const t = tabs[Math.floor(rnd() * 3)]!;
    const act = rnd();
    if (act < 0.65) answer(t);
    else if (act < 0.75) finish(t);
    else if (!t.offline || rnd() < 0.15) startSync(t);
    // responses arrive later and in any order; a tab that answered meanwhile replays its new moves
    for (const x of tabs) if (x.pending && rnd() < 0.5) deliver(x);
  }
  // converge: every device comes online and syncs until its PUT is accepted, twice round
  for (let k = 0; k < 2; k++)
    for (const t of tabs) {
      startSync(t);
      for (let guard = 0; !deliver(t); guard++) if (guard > 10) throw new Error("no convergence");
    }
  return { server: server.state, truth, misses, clears, violations, stats, tabs };
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe("rebase: two tabs and an offline device never lose each other's progress (AUD-01)", () => {
  for (const seed of [7, 42, 1234]) {
    it(`seed ${seed}: 200 steps, final server equals the sum of every increment`, () => {
      const { server, truth, violations, stats, misses, clears, tabs } = simulate(seed, rebase);
      expect(stats.s409).toBeGreaterThan(5); // the run really had conflicts
      expect(violations).toEqual([]);
      expect([server.xp, server.cro, server.rounds]).toEqual([truth.xp, truth.cro, truth.rounds]);
      expect(server.seen).toEqual(truth.seen);
      expect(sum(server.seen)).toBe(stats.answers);
      expect(server.hist).toEqual(truth.hist);
      // every device ends on the server's copy
      for (const t of tabs) expect(t.local.xp).toBe(server.xp);

      for (const q of new Set(misses.map((m) => m.q))) {
        const ms = misses.filter((m) => m.q === q), cs = clears.filter((c) => c.q === q);
        if (!(server.wrong[q]! > 0)) {
          // a miss may only disappear because some tab cleared the question without having seen that
          // clear happen first: a clear that came after it, or ran concurrently with it
          for (const m of ms) expect(cs.some((c) => !m.knewBefore.has(c.id)), `lost miss ${m.id} on ${q}`).toBe(true);
        } else {
          // a cleared miss never comes back: some miss on q was never seen by any clear
          expect(ms.some((m) => !cs.some((c) => c.knew.has(m.id))), `resurrected ${q}`).toBe(true);
        }
      }
    });
  }
  it("the same harness catches the old max-merge losing progress (the oracle has teeth)", () => {
    const old: Merge = (server, _base, local) => mergeStates(local, server);
    const lost = [7, 42, 1234].map((seed) => {
      const { server, truth } = simulate(seed, old);
      return truth.xp - server.xp;
    });
    expect(lost.some((d) => d > 0)).toBe(true);
  });
});
