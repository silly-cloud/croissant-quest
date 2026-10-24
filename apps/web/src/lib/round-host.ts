import { qid, TAGNAME, type Question } from "@cq/content";
import { pickQuestions, retired, SEEN_CAP, tagStats, type Rng } from "@cq/shared";
import { requestCoachRound, COACH_TIMEOUT_MS } from "./coach";
import { RoundEngine, type Effects, type Pace, type RoundMode, type Timers } from "./engine";
import type { GameStore } from "./game-store";

export interface HostSnapshot {
  engine: RoundEngine | null;
  /** the round whose results screen is showing */
  last: RoundEngine | null;
  /** a Fresh-questions request is in flight */
  busy: boolean;
  /** what happened to the last request, for the screen the learner is looking at */
  note: string | null;
  rev: number;
}

export const HOST_SERVER: HostSnapshot = { engine: null, last: null, busy: false, note: null, rev: 0 };

export interface HostDeps {
  getPace: () => Pace;
  fx?: Effects;
  fetch?: typeof fetch;
  timers?: Timers;
  rng?: Rng;
  today?: () => string;
  coachTimeoutMs?: number;
}

export type FreshResult = "ai" | "weak" | "empty" | "busy" | "stale";

export const EMPTY_NOTE = "You've used every question 3 times. Come back after a break.";
export const FALLBACK_NOTE = "Claude couldn't write them this time, so this drill comes from your own mistakes.";
export const freshenNote = (n: number) =>
  `You've seen ${n === 1 ? "one of these" : n + " of these"} ${SEEN_CAP} times. Claude is writing new ones…`;
export const repeatNote = (n: number) =>
  n === 1
    ? "1 of these is a repeat: Claude couldn't write a new one this time."
    : `${n} of these are repeats: Claude couldn't write new ones this time.`;
/** The coach answers with at least 4 valid questions or falls back (CoachRoundResponse), so never ask for fewer. */
const COACH_MIN = 4;

/**
 * Owns the one live round. Every way a round can start or end goes through here, and each
 * bumps `gen`, so a coach answer that arrives for an old request is ignored.
 */
export class RoundHost {
  private snap: HostSnapshot = HOST_SERVER;
  private listeners = new Set<() => void>();
  private gen = 0;
  private abort: AbortController | null = null;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;

  constructor(
    private readonly store: GameStore,
    private readonly deps: HostDeps,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private set(patch: Partial<HostSnapshot>) {
    this.snap = { ...this.snap, ...patch, rev: this.snap.rev + 1 };
    this.listeners.forEach((l) => l());
  }
  get engine() {
    return this.snap.engine;
  }
  get generation() {
    return this.gen;
  }

  /** Start a round with these questions. Whatever was running is cancelled first. */
  begin(topic: number, mode: RoundMode, qs: Question[]): RoundEngine {
    this.invalidate();
    this.endCurrent();
    const engine = new RoundEngine(topic, mode, qs, {
      repeats: new Set(retired(this.store.state, qs.filter((q) => !q._ai)).map(qid)),
      store: this.store,
      getPace: this.deps.getPace,
      fx: this.deps.fx,
      timers: this.deps.timers,
      rng: this.deps.rng,
      today: this.deps.today,
    });
    this.unsub = engine.subscribe(() => {
      if (engine.getSnapshot().phase === "done" && this.snap.engine === engine) this.set({ last: engine });
    });
    this.set({ engine, last: null, note: null, busy: false });
    return engine;
  }

  /** A round built from the learner's own record. null (and a note) when every question is used up. */
  startLocal(topic: number, mode: "normal" | "weak", picked?: Question[]): RoundEngine | null {
    const qs = picked ?? pickQuestions(this.store.bank, this.store.state, topic, mode, this.deps.rng);
    if (!qs.length) {
      this.set({ note: EMPTY_NOTE });
      return null;
    }
    return this.begin(topic, mode, qs);
  }

  /**
   * The round page's entry point. Like startLocal, but a topic-6 round holding questions already seen
   * SEEN_CAP times first asks the coach for that many new ones and swaps them in (legacy freshenRound).
   * If the coach falls back, the repeats stay and each is labelled. null: no questions, or the learner left.
   */
  async startRound(topic: number, mode: "normal" | "weak"): Promise<RoundEngine | null> {
    const qs = pickQuestions(this.store.bank, this.store.state, topic, mode, this.deps.rng);
    const stale = topic === 6 ? retired(this.store.state, qs.filter((q) => !q._ai)) : [];
    if (!qs.length || !stale.length) return this.startLocal(topic, mode, qs);
    if (this.snap.busy) return null;
    const g = ++this.gen;
    const ctl = new AbortController();
    this.abort = ctl;
    this.set({ busy: true, note: freshenNote(stale.length) });
    const made =
      (await requestCoachRound(this.deps.fetch ?? ((...a) => fetch(...a)), {
        n: Math.min(8, Math.max(COACH_MIN, stale.length)),
        focus: [...new Set(stale.map((q) => q.tag))],
        signal: ctl.signal,
        timeoutMs: this.deps.coachTimeoutMs ?? COACH_TIMEOUT_MS,
      })) ?? [];
    if (g !== this.gen) return null; // left the page, quit, or another round started
    this.abort = null;
    this.set({ busy: false });
    const out = qs.slice();
    stale.forEach((q, i) => {
      if (made[i]) out[out.indexOf(q)] = made[i]!;
    });
    const engine = this.begin(topic, mode, out);
    if (engine.repeats.size) this.set({ note: repeatNote(engine.repeats.size) });
    return engine;
  }

  private endCurrent() {
    this.unsub?.();
    this.unsub = null;
    this.snap.engine?.cancel();
  }

  /** Quit: cancel the round and every timer it owns, and any coach request in flight. */
  quit() {
    this.invalidate();
    this.endCurrent();
    this.set({ engine: null, busy: false });
  }

  /** Any request still waiting for the coach is now stale. */
  private invalidate() {
    this.abort?.abort();
    this.abort = null;
    this.gen++;
  }

  clearNote() {
    if (this.snap.note) this.set({ note: null });
  }

  /** The round page found a live round that matches its URL (Fresh questions started it, or a dev remount). */
  adopt(topic: number, mode: RoundMode): RoundEngine | null {
    if (this.killTimer) {
      clearTimeout(this.killTimer);
      this.killTimer = null;
    }
    const e = this.snap.engine;
    if (!e || e.cancelled) return null;
    if (e.topic === topic && e.mode === mode && e.getSnapshot().phase !== "done") return e;
    return null;
  }

  /** The round page went away. A finished round stays for the results screen; anything else is cancelled. */
  release() {
    if (this.killTimer) clearTimeout(this.killTimer);
    // deferred so a React dev remount can adopt again without losing the round
    this.killTimer = setTimeout(() => {
      this.killTimer = null;
      const e = this.snap.engine;
      if (!e) return;
      if (e.getSnapshot().phase === "done") {
        this.unsub?.();
        this.unsub = null;
        this.set({ engine: null, last: e });
      } else this.quit();
    }, 0);
  }

  cancelFresh() {
    if (!this.snap.busy) return;
    this.invalidate();
    this.set({ busy: false });
  }

  /**
   * "Fresh questions from Claude" / Drill. Never a dead button: if the coach is down, slow or
   * answers badly, a local Weak Spots round starts instead.
   */
  async fresh(): Promise<FreshResult> {
    if (this.snap.busy) return "busy"; // double press
    const g = ++this.gen;
    const ctl = new AbortController();
    this.abort = ctl;
    this.set({ busy: true, note: null });
    const stats = tagStats(this.store.state, TAGNAME).filter((s) => s.pct < 90);
    let qs: Awaited<ReturnType<typeof requestCoachRound>> = null;
    try {
      qs = await requestCoachRound(this.deps.fetch ?? ((...a) => fetch(...a)), {
        n: 8,
        focus: stats.slice(0, 4).map((s) => s.tag),
        signal: ctl.signal,
        timeoutMs: this.deps.coachTimeoutMs ?? COACH_TIMEOUT_MS,
      });
    } catch {
      qs = null;
    }
    // the round changed while we waited (Quit, another round, leaving the page): drop the answer
    if (g !== this.gen) return "stale";
    this.abort = null;
    this.set({ busy: false });
    if (qs && qs.length >= 4) {
      this.begin(6, "ai", qs);
      return "ai";
    }
    const local = pickQuestions(this.store.bank, this.store.state, 6, "weak", this.deps.rng);
    if (!local.length) {
      this.set({ note: EMPTY_NOTE });
      return "empty";
    }
    this.begin(6, "weak", local);
    this.set({ note: FALLBACK_NOTE });
    return "weak";
  }
}
