import { describe, expect, it } from "vitest";
import { BANK, qid } from "@cq/content";
import { MASTERED, emptyState, mergeStates, noteAnswer, normState, tagStats } from "../src/index.js";

const ids = new Set(BANK.map(qid));

describe("normState", () => {
  it("fills a missing/odd save with a valid state and mastered topics", () => {
    const n = normState(null);
    for (const t of MASTERED) expect(n.crowns[t]).toBe(5);
    expect(n.calib).toBe("aligned");
    expect(normState("garbage").xp).toBe(0);
    expect(normState({ xp: "12", log: "x", hist: [] }).xp).toBe(12);
  });
  it("[fixed #20] a __proto__ key cannot re-prototype the state", () => {
    const n = normState(JSON.parse('{"xp":5,"__proto__":{"evil":1},"wrong":{"__proto__":{"x":1}}}'));
    expect((n as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
    expect(Object.keys(n.wrong)).toEqual([]);
  });
  it("[fixed #14] hist keys that are not real rules are dropped (they reach the UI)", () => {
    const n = normState({ hist: { m: [1, 2], "<img src=x onerror=alert(1)>": [3, 4] } });
    expect(Object.keys(n.hist)).toEqual(["m"]);
  });
  it("drops mistakes for questions the bank no longer has", () => {
    const real = [...ids][0]!;
    const n = normState({ wrong: { [real]: 2, "6|choice|gone|x": 1 } }, ids);
    expect(Object.keys(n.wrong)).toEqual([real]);
  });
  it("keeps only known, length-capped log fields and caps list sizes", () => {
    const big = "x".repeat(5000);
    const n = normState({
      xp: -5, cro: 1e308, feel: 900,
      log: [{ q: big, gave: big, tag: big, at: 1, evil: "<img onerror=1>" }, "junk", null],
      feelLog: Array.from({ length: 50 }, (_, i) => ({ feel: 999, mine: i, at: i, extra: 1 })),
    });
    expect(n.xp).toBe(0);
    expect(n.cro).toBe(Number.MAX_SAFE_INTEGER);
    expect(n.feel).toBe(100);
    expect(n.log).toHaveLength(1);
    expect(n.log[0]!.gave).toHaveLength(60);
    expect(n.log[0]!.q).toHaveLength(400);
    expect(Object.keys(n.log[0]!).sort()).toEqual(["at", "gave", "q", "t", "tag"]);
    expect(n.feelLog).toHaveLength(20);
    expect(n.feelLog[0]!.feel).toBe(100);
  });
  it("accepts an old-style save (seen flag 1) as a count", () => {
    expect(normState({ seen: { a: 1 } }).seen.a).toBe(1);
  });
});

describe("mergeStates", () => {
  const N = (o: object) => normState(o);
  it("counters never shrink; hist and seen take the larger", () => {
    const m = mergeStates(N({ xp: 10, ts: 2, hist: { m: [3, 1] }, seen: { a: 1 } }), N({ xp: 23, ts: 1, hist: { m: [2, 4] }, seen: { a: 3, b: 1 } }));
    expect(m.xp).toBe(23);
    expect(m.hist.m).toEqual([3, 4]);
    expect(m.seen).toEqual({ a: 3, b: 1 });
  });
  it("wrong, feel and calib come from the newer copy", () => {
    const older = N({ ts: 1, wrong: { a: 3 }, feel: 10, calib: "more" });
    const newer = N({ ts: 2, wrong: {}, feel: 80, calib: "harder" });
    for (const m of [mergeStates(older, newer), mergeStates(newer, older)]) {
      expect(m.wrong).toEqual({});
      expect(m.feel).toBe(80);
      expect(m.calib).toBe("harder");
    }
  });
  it("is symmetric on counters and idempotent", () => {
    const a = N({ xp: 5, ts: 1, crowns: { 6: 2 } }), b = N({ xp: 9, ts: 2, crowns: { 6: 1 } });
    expect(mergeStates(a, b).crowns[6]).toBe(2);
    expect(mergeStates(b, a).xp).toBe(9);
    const m = mergeStates(a, b);
    expect(mergeStates(m, m)).toEqual(m);
  });
});

describe("hist helpers", () => {
  it("noteAnswer counts right/wrong per tag and tagStats sorts worst first", () => {
    const s = emptyState();
    noteAnswer(s, "m", true); noteAnswer(s, "m", true); noteAnswer(s, "f", false); noteAnswer(s, undefined, true);
    const st = tagStats(s, { m: "du", f: "de la" });
    expect(st.map((x) => [x.tag, x.pct])).toEqual([["f", 0], ["m", 100]]);
  });
});
