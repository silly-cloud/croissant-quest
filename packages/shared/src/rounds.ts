import { TAG, qid, type Question } from "@cq/content";
import { SEEN_CAP, type Calib, type State } from "./state.js";

export type Rng = () => number;
export type Mode = "normal" | "weak";

export function shuffle<T>(a: readonly T[], rng: Rng = Math.random): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

/** The one rule the learner is losing on: at least 3 attempts, under 60%. Drives the boss card. */
export function weakTag(s: State): string | null {
  let worst: string | null = null, wa = 1;
  for (const k of Object.keys(s.hist)) {
    if (!TAG[k]) continue;
    const h = s.hist[k]!, n = h[0] + h[1];
    if (n < 3) continue;
    const a = h[0] / n;
    if (a < 0.6 && a < wa) { wa = a; worst = k; }
  }
  return worst;
}

/** Rules split by lifetime record: 90%+ (with 2+ attempts) are strong, the rest weak. */
export function ruleSplit(s: State): { strong: string[]; weak: string[] } {
  const strong: string[] = [], weak: string[] = [];
  for (const k of Object.keys(s.hist)) {
    if (!TAG[k]) continue;
    const h = s.hist[k]!, n = h[0] + h[1];
    if (n < 2) continue;
    (h[0] / n >= 0.9 ? strong : weak).push(k);
  }
  return { strong, weak };
}

const seenN = (s: State, q: Question) => s.seen[qid(q)] ?? 0;
/** Still outstanding in `wrong`: not retired, Weak Spots keeps serving it until it is right. */
const outstanding = (s: State, q: Question) => (s.wrong[qid(q)] ?? 0) > 0;
export const live = (s: State, qs: Question[]) => qs.filter((q) => seenN(s, q) < SEEN_CAP || outstanding(s, q));
export const retired = (s: State, qs: Question[]) => qs.filter((q) => seenN(s, q) >= SEEN_CAP && !outstanding(s, q));

/** Pick up to 8 questions for a round. Never ships a short round if the bank can fill it. */
export function pickQuestions(
  bank: Question[], s: State, topic: number, mode: Mode, rng: Rng = Math.random,
): Question[] {
  const hasContent = (t: number) => bank.some((q) => q.t === t);
  const drawFrom = (pool: Question[], n: number) => shuffle(live(s, pool), rng).slice(0, n);
  const topUp = (out: Question[], t: number, maxTier = 9) => {
    const add = (q: Question) => { if (!out.includes(q) && out.length < 8) out.push(q); };
    shuffle(live(s, bank.filter((q) => q.t === t && q.tier <= maxTier)), rng).forEach(add);
    shuffle(live(s, bank.filter((q) => hasContent(q.t) && q.tier <= maxTier)), rng).forEach(add);
    shuffle(retired(s, bank.filter((q) => q.t === t && q.tier <= maxTier)), rng).forEach(add);
    return out;
  };

  if (mode === "weak") {
    const { strong, weak } = ruleSplit(s);
    if (s.calib === "proof") {
      const win = bank.filter((q) => strong.includes(q.tag) && q.tier <= 3 && q.k === "choice");
      const o: Question[] = [];
      const add = (q: Question) => { if (!o.includes(q) && o.length < 8) o.push(q); };
      drawFrom(win, 6).forEach(add);
      drawFrom(bank.filter((q) => weak.includes(q.tag) && q.tier <= 2), 2).forEach(add);
      drawFrom(win, 8).forEach(add);
      return shuffle(topUp(o, 6), rng);
    }
    const nHard = s.calib === "harder" ? 4 : s.calib === "more" ? 1 : 3;
    const hard = drawFrom(bank.filter((q) => strong.includes(q.tag) && (q.tier >= 4 || q.k !== "choice")), nHard);
    const missed = Object.keys(s.wrong).sort((a, b) => (s.wrong[b] ?? 0) - (s.wrong[a] ?? 0));
    const out: Question[] = [];
    const push = (q: Question) => { if (!out.includes(q) && out.length < 8) out.push(q); };
    hard.forEach(push);
    drawFrom(bank.filter((q) => missed.includes(qid(q))), 8).forEach(push);
    drawFrom(bank.filter((q) => weak.includes(q.tag) && !missed.includes(qid(q))), 8).forEach(push);
    return shuffle(topUp(out, 6), rng);
  }

  const crown = s.crowns[topic] ?? 0;
  const target = Math.min(5, crown + 1);
  const pool = bank.filter((q) => q.t === topic && q.tier <= target);
  let main = drawFrom(pool.filter((q) => q.tier === target), 5).concat(drawFrom(pool.filter((q) => q.tier < target), 3));
  if (main.length < 6) main = drawFrom(pool, 6);
  // Spaced review from earlier topics, really weighted to past mistakes (audit item 18):
  // most-missed first, ties shuffled, and no second reshuffle.
  const revPool = bank.filter((q) => q.t < topic && hasContent(q.t));
  const rev = shuffle(live(s, revPool), rng)
    .sort((a, b) => (s.wrong[qid(b)] ?? 0) - (s.wrong[qid(a)] ?? 0))
    .slice(0, 2);
  let out = shuffle(topUp(main.slice(0, 6).concat(rev), topic, target), rng);
  const wt = weakTag(s);
  if (wt) {
    const fixes = drawFrom(bank.filter((q) => q.tag === wt), 3);
    if (fixes.length) {
      const o: Question[] = [];
      const push = (q: Question) => { if (!o.includes(q) && o.length < 8) o.push(q); };
      fixes.forEach(push);
      out.filter((q) => q.tag !== wt).forEach(push);
      drawFrom(pool, 8).forEach(push);
      drawFrom(revPool, 8).forEach(push);
      out = shuffle(topUp(o, topic, target), rng);
    }
  }
  return out;
}

export interface RoundRecord { tag: string; ok: boolean }

/** XP for a correct answer at the given (already incremented) combo. */
export const xpFor = (combo: number) => 10 + Math.min(20, (combo - 1) * 3);

/** Your honest rating: this round (60%) and your lifetime record on the rules it touched (40%), capped by the worst rule. */
export function myRate(s: State, record: RoundRecord[]): number {
  const n = record.length || 1;
  const round = record.filter((r) => r.ok).length / n;
  const touched = [...new Set(record.map((r) => r.tag).filter(Boolean))];
  let r = 0, t = 0;
  for (const k of touched) { const h = s.hist[k] ?? [0, 0]; r += h[0]; t += h[0] + h[1]; }
  const life = t ? r / t : round;
  let pct = Math.round((round * 0.6 + life * 0.4) * 100);
  const worst = touched
    .map((k) => { const h = s.hist[k] ?? [0, 0], tt = h[0] + h[1]; return tt >= 2 ? h[0] / tt : 1; })
    .reduce((a, b) => Math.min(a, b), 1);
  if (worst < 0.6) pct = Math.min(pct, 65);
  else if (worst < 0.9) pct = Math.min(pct, 85);
  return Math.max(0, Math.min(100, pct));
}

/** Locking the feel meter: how far apart the learner and the game are decides the next drill. */
export function calibFor(feel: number, mine: number): Calib {
  const gap = feel - mine;
  return gap <= -25 && mine >= 50 ? "proof" : gap >= 15 ? "harder" : gap <= -15 ? "more" : "aligned";
}

export interface RoundSummary {
  topic: number; mode: "normal" | "weak" | "ai"; hearts: number; right: number;
  questions: { t: number }[];
}
export interface RoundOutcome { crowned: boolean; perfect: boolean }

/** Day string before `today` (YYYY-MM-DD) by calendar arithmetic, safe across DST changes. */
export function dayBefore(today: string): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d - 1));
  return dt.toISOString().slice(0, 10);
}

/** Apply a finished round to the state (mutates `s`): crown, croissant, round count, streak. */
export function scoreRound(s: State, r: RoundSummary, today: string): RoundOutcome {
  const n = r.questions.length;
  const perfect = r.right === n;
  let crowned = false;
  const own = r.questions.filter((q) => q.t === r.topic).length;
  if (r.mode === "normal" && r.hearts > 0 && own >= Math.ceil(n / 2)) {
    const c = s.crowns[r.topic] ?? 0;
    const need = c >= 3 ? n : n - 1;
    if (r.right >= need && c < 5) { s.crowns[r.topic] = c + 1; crowned = true; }
  }
  // a croissant is for a full-length perfect round (item 20: a 4-question AI round no longer earns one)
  if (perfect && n >= 8) s.cro += 1;
  s.rounds += 1;
  if (s.last !== today) {
    s.streak = s.last === dayBefore(today) ? s.streak + 1 : 1;
    s.last = today;
  }
  return { crowned, perfect };
}
