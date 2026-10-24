import { qid, type Question } from "@cq/content";
import {
  accentsOnly,
  fullOf,
  judge,
  noteAnswer,
  pron,
  scoreRound,
  shuffle,
  xpFor,
  type PronResult,
  type Rng,
  type RoundOutcome,
  type RoundRecord,
} from "@cq/shared";
import type { GameStore } from "./game-store";

export type Pace = "fast" | "study";
export type RoundMode = "normal" | "weak" | "ai";

/**
 * asking     waiting for an answer
 * correct    right answer shown; fast pace moves on by itself after AUTO_MS
 * held       right answer shown and kept on screen until Continue
 * wrong      wrong answer marked, why-card about to open
 * why        why-card open
 * finishing  last question done, results about to show
 * done       results are available
 */
export type Phase = "asking" | "correct" | "held" | "wrong" | "why" | "finishing" | "done";

export const AUTO_MS = 3400;
export const WHY_DELAY_MS = 420;
export const FINISH_MS = 200;
export const HEARTS = 5;

export interface AnswerRow extends RoundRecord {
  kind: Question["k"];
  ask: string;
  want: string;
  gave: string;
  full: string;
  en: string;
  pr: PronResult;
}

export interface QuestionView {
  /** choice / fr2en: the options in the order shown (the answer is always among them) */
  options: string[];
  /** build: the shuffled word tiles */
  tiles: string[];
  /** fix: the sentence split into tappable words */
  words: string[];
}

export interface RoundSnapshot {
  topic: number;
  mode: RoundMode;
  qs: Question[];
  i: number;
  hearts: number;
  right: number;
  xp: number;
  combo: number;
  best: number;
  phase: Phase;
  picked: string | null;
  ok: boolean | null;
  accentsOnly: boolean;
  record: AnswerRow[];
  outcome: RoundOutcome | null;
  /** counts up on every state change so React can tell snapshots apart */
  rev: number;
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(id: unknown): void;
}

const windowTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};

export interface Effects {
  right?(combo: number, gain: number): void;
  wrong?(): void;
  crown?(): void;
  finish?(perfect: boolean): void;
}

export interface EngineDeps {
  store: GameStore;
  getPace: () => Pace;
  rng?: Rng;
  timers?: Timers;
  today?: () => string;
  fx?: Effects;
}

/** The learner's local calendar day, not UTC (an evening in India must not read as tomorrow). */
export const localToday = () => new Date().toLocaleDateString("en-CA");

/**
 * One round, from the first question to the score. It owns every timer it starts:
 * cancel() (Quit, leaving the page, starting another round) clears them all and turns
 * every method into a no-op, so a stale timer can never touch the next round.
 */
let seq = 0;
export class RoundEngine {
  readonly id = ++seq;
  private snap: RoundSnapshot;
  private listeners = new Set<() => void>();
  private pending = new Set<unknown>();
  private auto: unknown = null;
  private dead = false;
  private views = new Map<number, QuestionView>();
  private readonly timers: Timers;
  private readonly rng: Rng;
  private readonly today: () => string;
  /** my honest rating of the round, computed once when the results show */
  mine: number | null = null;

  constructor(
    readonly topic: number,
    readonly mode: RoundMode,
    questions: Question[],
    private readonly deps: EngineDeps,
  ) {
    this.timers = deps.timers ?? windowTimers;
    this.rng = deps.rng ?? Math.random;
    this.today = deps.today ?? localToday;
    this.snap = {
      topic,
      mode,
      qs: questions,
      i: 0,
      hearts: HEARTS,
      right: 0,
      xp: 0,
      combo: 0,
      best: 0,
      phase: "asking",
      picked: null,
      ok: null,
      accentsOnly: false,
      record: [],
      outcome: null,
      rev: 0,
    };
  }

  /* ---------- store plumbing ---------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private set(patch: Partial<RoundSnapshot>) {
    this.snap = { ...this.snap, ...patch, rev: this.snap.rev + 1 };
    this.listeners.forEach((l) => l());
  }

  get cancelled() {
    return this.dead;
  }
  get question(): Question {
    return this.snap.qs[this.snap.i]!;
  }

  /** Options / tiles / words for the current question, shuffled once and kept. */
  view(i = this.snap.i): QuestionView {
    const cached = this.views.get(i);
    if (cached) return cached;
    const q = this.snap.qs[i]!;
    // an unanswerable question is worse than a wrong one: the answer is always on screen
    const opts = (q.o ?? []).slice();
    if ((q.k === "choice" || q.k === "fr2en") && !opts.includes(q.a)) opts.push(q.a);
    const v: QuestionView = {
      options: q.k === "choice" || q.k === "fr2en" ? shuffle(opts, this.rng) : [],
      tiles: q.k === "build" ? shuffle(q.a.replace(/[.!?]$/, "").split(" "), this.rng) : [],
      words: q.k === "fix" ? (q.s ?? "").split(" ") : [],
    };
    this.views.set(i, v);
    return v;
  }

  /* ---------- timers ---------- */
  private later(fn: () => void, ms: number): unknown {
    const id = this.timers.set(() => {
      this.pending.delete(id);
      if (!this.dead) fn();
    }, ms);
    this.pending.add(id);
    return id;
  }
  private clearAuto() {
    if (this.auto !== null) {
      this.timers.clear(this.auto);
      this.pending.delete(this.auto);
      this.auto = null;
    }
  }

  /** Stop everything this round started. Safe to call twice. */
  cancel() {
    this.dead = true;
    this.pending.forEach((id) => this.timers.clear(id));
    this.pending.clear();
    this.auto = null;
  }

  /** timers still scheduled (tests) */
  get pendingTimers() {
    return this.pending.size;
  }

  /* ---------- answering ---------- */
  answer(picked: string | null): boolean | null {
    if (this.dead || this.snap.phase !== "asking") return null;
    const q = this.question;
    const ok = judge(q, picked);
    const near = accentsOnly(q, picked, ok);
    const gave = String(picked ?? "").slice(0, 60);
    const full = fullOf(q);
    const row: AnswerRow = {
      tag: q.tag,
      ok,
      kind: q.k,
      ask: q.s || q.en || "",
      want: q.a,
      gave,
      full,
      en: q.en || "",
      pr: q.pr?.e ? q.pr : pron(full),
    };
    const id = qid(q);
    const s = this.snap;
    const combo = ok ? s.combo + 1 : 0;
    const gain = ok ? xpFor(combo) : 0;

    this.deps.store.update((d) => {
      noteAnswer(d, q.tag, ok);
      // a COUNT, not a flag: three tries retire a question (SEEN_CAP)
      if (!q._ai) d.seen[id] = (d.seen[id] ?? 0) + 1;
      if (ok) {
        d.xp += gain;
        if (d.wrong[id]) {
          d.wrong[id]--;
          if (d.wrong[id]! <= 0) delete d.wrong[id];
        }
      } else {
        // an AI question is not in the bank, so Weak Spots could never serve it again: log it, do not queue it
        if (!q._ai) d.wrong[id] = (d.wrong[id] ?? 0) + 1;
        d.log.push({ q: id, t: q.t, tag: q.tag, gave, at: Date.now() });
      }
    });

    if (ok) {
      const fast = this.deps.getPace() === "fast";
      this.set({
        phase: fast ? "correct" : "held",
        picked,
        ok,
        accentsOnly: false,
        right: s.right + 1,
        combo,
        best: Math.max(s.best, combo),
        xp: s.xp + gain,
        record: [...s.record, row],
      });
      this.deps.fx?.right?.(combo, gain);
      if (fast) this.auto = this.later(() => this.next(), AUTO_MS);
    } else {
      this.set({
        phase: "wrong",
        picked,
        ok,
        accentsOnly: near,
        combo: 0,
        hearts: s.hearts - 1,
        record: [...s.record, row],
      });
      this.deps.fx?.wrong?.();
      // choice taps get a beat to show red/green before the card opens
      const instant = q.k === "choice" || q.k === "fr2en";
      if (instant) this.later(() => this.openWhy(), WHY_DELAY_MS);
      else this.openWhy();
    }
    return ok;
  }

  private openWhy() {
    if (this.snap.phase === "wrong") this.set({ phase: "why" });
  }

  /** Fast pace: tapping the card stops the countdown and keeps the answer on screen. */
  hold() {
    if (this.dead || this.snap.phase !== "correct") return;
    this.clearAuto();
    this.set({ phase: "held" });
  }

  /** Continue / Got it / auto-advance. Only valid after an answer has been shown. */
  next() {
    if (this.dead) return;
    const p = this.snap.phase;
    if (p !== "correct" && p !== "held" && p !== "why") return;
    this.clearAuto();
    const i = this.snap.i + 1;
    if (i >= this.snap.qs.length || this.snap.hearts <= 0) {
      this.set({ phase: "finishing", i: Math.min(i, this.snap.qs.length - 1) });
      this.later(() => this.finish(), FINISH_MS);
      return;
    }
    this.set({ i, phase: "asking", picked: null, ok: null, accentsOnly: false });
  }

  private finish() {
    const s = this.snap;
    let outcome: RoundOutcome = { crowned: false, perfect: false };
    this.deps.store.update((d) => {
      outcome = scoreRound(d, { topic: s.topic, mode: s.mode, hearts: s.hearts, right: s.right, questions: s.qs }, this.today());
    });
    this.set({ phase: "done", outcome });
    if (outcome.crowned) this.deps.fx?.crown?.();
    else if (s.hearts > 0) this.deps.fx?.finish?.(outcome.perfect);
  }
}
