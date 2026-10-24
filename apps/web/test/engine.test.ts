import { describe, expect, it, vi, beforeEach } from "vitest";
import { BANK, qid } from "@cq/content";
import { pickQuestions, xpFor } from "@cq/shared";
import { AUTO_MS, FINISH_MS, HEARTS, WHY_DELAY_MS } from "@/lib/engine";
import { makeEngine, makeHost, makeStore, rightPick, wrongPick } from "./helpers";

const topic6 = (n = 8) => pickQuestions(BANK, makeStore().store.state, 6, "normal", () => 0.3).slice(0, n);

beforeEach(() => vi.useFakeTimers());

describe("round engine", () => {
  it("scores XP with the combo ladder and ends the round with a result", () => {
    const { store } = makeStore();
    const qs = topic6();
    const e = makeEngine(store, qs, "normal", "study");
    let expected = 0;
    qs.forEach((_, i) => {
      expect(e.answer(rightPick(e.question))).toBe(true);
      expected += xpFor(i + 1);
      e.next();
    });
    expect(e.getSnapshot().phase).toBe("finishing");
    vi.advanceTimersByTime(FINISH_MS);
    const s = e.getSnapshot();
    expect(s.phase).toBe("done");
    expect(s.xp).toBe(expected);
    expect(store.state.xp).toBe(expected);
    expect(s.outcome?.perfect).toBe(true);
    expect(store.state.rounds).toBe(1);
    expect(store.state.cro).toBe(1);
    expect(store.state.crowns[6]).toBe(1);
  });

  it("five wrong answers end the round with no crown", () => {
    const { store } = makeStore();
    const e = makeEngine(store, topic6(), "normal", "study");
    for (let i = 0; i < HEARTS; i++) {
      e.answer(wrongPick(e.question));
      vi.advanceTimersByTime(WHY_DELAY_MS);
      expect(e.getSnapshot().phase).toBe("why");
      e.next();
    }
    vi.advanceTimersByTime(FINISH_MS);
    expect(e.getSnapshot().phase).toBe("done");
    expect(e.getSnapshot().hearts).toBe(0);
    expect(e.getSnapshot().outcome?.crowned).toBe(false);
    expect(Object.keys(store.state.wrong).length).toBeGreaterThan(0);
  });

  it("counts every answer toward SEEN_CAP and clears a miss once it is answered right", () => {
    const { store } = makeStore();
    const q = BANK.find((x) => x.t === 6 && x.k === "choice")!;
    const e = makeEngine(store, [q, q], "weak", "study");
    e.answer(wrongPick(q));
    vi.advanceTimersByTime(WHY_DELAY_MS);
    e.next();
    expect(store.state.wrong[qid(q)]).toBe(1);
    e.answer(rightPick(q));
    expect(store.state.wrong[qid(q)]).toBeUndefined();
    expect(store.state.seen[qid(q)]).toBe(2);
  });

  it("does not queue or count coach-written (_ai) questions", () => {
    const { store } = makeStore();
    const q = { ...BANK.find((x) => x.t === 6 && x.k === "choice")!, _ai: true };
    const e = makeEngine(store, [q], "ai", "study");
    e.answer(wrongPick(q));
    expect(store.state.wrong).toEqual(expect.not.objectContaining({ [qid(q)]: expect.anything() }));
    expect(store.state.seen[qid(q)]).toBeUndefined();
    expect(store.state.log).toHaveLength(1);
  });

  it("ignores a second press on the same question", () => {
    const { store } = makeStore();
    const e = makeEngine(store, topic6(), "normal", "study");
    const q = e.question;
    expect(e.answer(rightPick(q))).toBe(true);
    expect(e.answer(wrongPick(q))).toBeNull();
    expect(e.getSnapshot().right).toBe(1);
    expect(e.getSnapshot().hearts).toBe(HEARTS);
  });

  it("fast pace moves on by itself after 3.4 s, and tapping the card holds it", () => {
    const { store } = makeStore();
    const e = makeEngine(store, topic6(), "normal", "fast");
    e.answer(rightPick(e.question));
    expect(e.getSnapshot().phase).toBe("correct");
    vi.advanceTimersByTime(AUTO_MS - 1);
    expect(e.getSnapshot().i).toBe(0);
    vi.advanceTimersByTime(1);
    expect(e.getSnapshot().i).toBe(1);

    e.answer(rightPick(e.question));
    e.hold();
    vi.advanceTimersByTime(AUTO_MS * 3);
    expect(e.getSnapshot().phase).toBe("held");
    expect(e.getSnapshot().i).toBe(1);
    e.next();
    expect(e.getSnapshot().i).toBe(2);
  });

  it("study pace never auto-advances", () => {
    const { store } = makeStore();
    const e = makeEngine(store, topic6(), "normal", "study");
    e.answer(rightPick(e.question));
    expect(e.getSnapshot().phase).toBe("held");
    expect(e.pendingTimers).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(e.getSnapshot().i).toBe(0);
  });

  it("cancel() clears every timer and turns the engine inert", () => {
    const { store } = makeStore();
    const e = makeEngine(store, topic6(), "normal", "fast");
    e.answer(rightPick(e.question));
    expect(e.pendingTimers).toBe(1);
    e.cancel();
    expect(e.pendingTimers).toBe(0);
    vi.advanceTimersByTime(AUTO_MS * 2);
    expect(e.getSnapshot().i).toBe(0);
    const xp = store.state.xp;
    expect(e.answer("x")).toBeNull();
    e.next();
    expect(store.state.xp).toBe(xp);
  });
});

describe("Quit and stale timers", () => {
  it("a timer left from a quit round never acts on the next round", () => {
    const { store } = makeStore();
    const host = makeHost(store, { pace: "fast" });
    const first = host.begin(6, "normal", topic6());
    first.answer(rightPick(first.question)); // starts the 3.4 s auto-advance
    host.quit();
    expect(first.cancelled).toBe(true);
    expect(first.pendingTimers).toBe(0);

    const second = host.begin(6, "normal", topic6());
    vi.advanceTimersByTime(AUTO_MS + 1000);
    expect(second.getSnapshot().i).toBe(0); // question 1 is still showing
    expect(second.getSnapshot().phase).toBe("asking");
    expect(first.getSnapshot().i).toBe(0);
  });

  it("a wrong answer's pending why-card never opens after Quit", () => {
    const { store } = makeStore();
    const host = makeHost(store);
    const e = host.begin(6, "normal", topic6());
    e.answer(wrongPick(e.question)); // why-card timer pending
    host.quit();
    vi.advanceTimersByTime(WHY_DELAY_MS * 2);
    expect(e.getSnapshot().phase).toBe("wrong");
    expect(host.engine).toBeNull();
  });

  it("starting a new round cancels the old one's timers", () => {
    const { store } = makeStore();
    const host = makeHost(store);
    const a = host.begin(6, "normal", topic6());
    a.answer(rightPick(a.question));
    host.begin(6, "normal", topic6());
    expect(a.pendingTimers).toBe(0);
    expect(a.cancelled).toBe(true);
  });

  it("the last question's finish timer dies with the round", () => {
    const { store } = makeStore();
    const host = makeHost(store, { pace: "study" });
    const e = host.begin(6, "normal", topic6(1));
    e.answer(rightPick(e.question));
    e.next(); // schedules finish
    host.quit();
    vi.advanceTimersByTime(FINISH_MS * 3);
    expect(e.getSnapshot().phase).toBe("finishing");
    expect(store.state.rounds).toBe(0);
  });
});
