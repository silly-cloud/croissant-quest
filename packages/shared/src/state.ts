import { TAG } from "@cq/content";

export type Calib = "harder" | "more" | "aligned" | "proof";
export interface LogEntry { q: string; t: number; tag: string; gave: string; at: number }
export interface FeelEntry { feel: number; mine: number; [k: string]: unknown }

export interface State {
  xp: number; cro: number; streak: number; rounds: number; ts: number;
  last: string | null;
  crowns: Record<string, number>;
  wrong: Record<string, number>;
  seen: Record<string, number>;
  hist: Record<string, [number, number]>;
  log: LogEntry[];
  feelLog: FeelEntry[];
  feel: number | null;
  calib: Calib;
}

/** Topics 1-5 start mastered (they have too few questions to play). */
export const MASTERED = [1, 2, 3, 4, 5];
export const SEEN_CAP = 3;
const COUNTERS = ["xp", "cro", "rounds", "streak"] as const;
const CALIBS: Calib[] = ["harder", "more", "aligned", "proof"];

export function emptyState(): State {
  const s: State = {
    xp: 0, cro: 0, streak: 0, rounds: 0, ts: 0, last: null,
    crowns: {}, wrong: {}, seen: {}, hist: {}, log: [], feelLog: [], feel: null, calib: "aligned",
  };
  MASTERED.forEach((t) => (s.crowns[t] = 5));
  return s;
}

const plainMap = (x: unknown): Record<string, unknown> => {
  const r: Record<string, unknown> = {};
  if (x && typeof x === "object" && !Array.isArray(x))
    for (const k of Object.keys(x)) if (k !== "__proto__") r[k] = (x as Record<string, unknown>)[k];
  return r;
};
/** A finite, non-negative number (counters never go below zero or past what a JSON number can hold safely). */
const num = (x: unknown) => {
  const n = +(x as number);
  return Number.isFinite(n) ? Math.min(Math.max(n, 0), Number.MAX_SAFE_INTEGER) : 0;
};
const str = (x: unknown, max: number) => (typeof x === "string" ? x.slice(0, max) : "");
const LOG_MAX = 500, FEELLOG_MAX = 20;
/** Keep only the known fields of a log entry, with capped lengths: these reach the UI and the db. */
const cleanLog = (e: unknown): LogEntry | null => {
  if (!e || typeof e !== "object") return null;
  const r = e as Record<string, unknown>;
  return { q: str(r.q, 400), t: num(r.t), tag: str(r.tag, 24), gave: str(r.gave, 60), at: num(r.at) };
};
const cleanFeel = (e: unknown): FeelEntry | null => {
  if (!e || typeof e !== "object") return null;
  const r = e as Record<string, unknown>;
  return { feel: Math.min(num(r.feel), 100), mine: Math.min(num(r.mine), 100), at: num(r.at), r: num(r.r) };
};

/**
 * Turn any saved shape (this device, the db, an old save) into a safe State:
 * known keys only, right types, no __proto__, no mistakes for questions the bank no longer has,
 * no history for rules that do not exist (those keys reach the UI).
 * `knownQids`: when given, `wrong` entries not in it are dropped.
 */
export function normState(v: unknown, knownQids?: Set<string>): State {
  const src = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  const o = emptyState();
  for (const k of COUNTERS) o[k] = num(src[k]);
  o.ts = num(src.ts);
  o.last = typeof src.last === "string" ? src.last : null;
  const crowns = plainMap(src.crowns), wrong = plainMap(src.wrong), seen = plainMap(src.seen);
  o.crowns = {}; for (const k in crowns) o.crowns[k] = num(crowns[k]);
  o.wrong = {}; for (const k in wrong) o.wrong[k] = num(wrong[k]);
  o.seen = {}; for (const k in seen) o.seen[k] = num(seen[k]);
  const h = plainMap(src.hist);
  for (const t of Object.keys(h)) {
    const e = h[t];
    if (Array.isArray(e) && Object.prototype.hasOwnProperty.call(TAG, t)) o.hist[t] = [num(e[0]), num(e[1])];
  }
  o.log = (Array.isArray(src.log) ? src.log : []).slice(-LOG_MAX).map(cleanLog).filter((e): e is LogEntry => !!e);
  o.feelLog = (Array.isArray(src.feelLog) ? src.feelLog : []).slice(-FEELLOG_MAX).map(cleanFeel).filter((e): e is FeelEntry => !!e);
  o.feel = typeof src.feel === "number" && Number.isFinite(src.feel) ? Math.min(Math.max(src.feel, 0), 100) : null;
  o.calib = CALIBS.includes(src.calib as Calib) ? (src.calib as Calib) : "aligned";
  MASTERED.forEach((t) => { if (!o.crowns[t]) o.crowns[t] = 5; });
  if (knownQids) for (const k of Object.keys(o.wrong)) if (!knownQids.has(k)) delete o.wrong[k];
  return o;
}

const topCounts = (a: Record<string, number>, b: Record<string, number>) => {
  const r: Record<string, number> = {};
  for (const x of [a, b]) for (const i of Object.keys(x)) r[i] = Math.max(r[i] ?? 0, x[i] ?? 0);
  return r;
};

/**
 * Two copies of one save. Counters only grow, so the larger is right; wrong, log, feel, calib
 * and last come from whichever copy has the larger `ts`.
 */
export function mergeStates(a: State, b: State): State {
  const [lo, hi] = a.ts > b.ts ? [b, a] : [a, b];
  const m: State = { ...lo, ...hi };
  for (const k of COUNTERS) m[k] = Math.max(a[k], b[k]);
  m.crowns = topCounts(a.crowns, b.crowns);
  m.seen = topCounts(a.seen, b.seen);
  m.hist = {};
  for (const x of [a.hist, b.hist])
    for (const t of Object.keys(x)) {
      const c = m.hist[t] ?? [0, 0];
      m.hist[t] = [Math.max(c[0], x[t]![0]), Math.max(c[1], x[t]![1])];
    }
  m.ts = Math.max(a.ts, b.ts);
  return m;
}

/** Count one answer against its rule tag (mutates `s`). */
export function noteAnswer(s: State, tag: string | undefined, ok: boolean): void {
  if (!tag) return;
  const h = s.hist[tag] ?? [0, 0];
  h[ok ? 0 : 1]++;
  s.hist[tag] = h;
}

export function tagStats(s: State, names: Record<string, string>) {
  const out: { tag: string; name: string; right: number; total: number; pct: number }[] = [];
  for (const k of Object.keys(s.hist)) {
    const [r, w] = s.hist[k]!;
    const n = r + w;
    if (!n) continue;
    out.push({ tag: k, name: names[k] ?? k, right: r, total: n, pct: Math.round((r / n) * 100) });
  }
  return out.sort((a, b) => a.pct - b.pct);
}
