// Mutation-killing tests from the C-shared audit lane. Each `it` name starts with the mutant ids it kills.
import { describe, expect, it } from "vitest";
import { BANK, Question, qid } from "@cq/content";
import {
  accentsOnly, calibFor, CoachExplainBody, CoachRoundBody, CoachRoundResponse, dayBefore, emptyState, live, mergeStates, myRate,
  normState, pickQuestions, pron, ProgressResponse, retired, scoreRound, weakTag, SEEN_CAP,
} from "../src/index.js";

const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const qs = (n: number, t = 6) => Array.from({ length: n }, () => ({ t }));
const round = (o: object) => ({ topic: 6, mode: "normal" as const, hearts: 5, right: 8, questions: qs(8), ...o });

describe("killers", () => {
  it("M23 liaison consumes the linked word exactly once", () => {
    expect(pron("des amis").e).toBe("Day-za-MEE");
  });
  it("M19 M21 nous avons / des homme link", () => {
    expect(pron("nous avons").e).toContain("-z");
    expect(pron("des homme").e).toContain("-z");
  });
  it("M28 M29 M55 SEEN_CAP: live below 3 views, retired at 3", () => {
    const q = BANK[10]!, s = emptyState();
    s.seen[qid(q)] = 2;
    expect(live(s, [q])).toHaveLength(1);
    s.seen[qid(q)] = 3;
    expect(retired(s, [q])).toHaveLength(1);
    expect(live(s, [q])).toHaveLength(0);
    expect(SEEN_CAP).toBe(3);
  });
  it("M32 a 400-char key is kept", () => {
    expect(normState({ seen: { ["k".repeat(400)]: 1 } }).seen["k".repeat(400)]).toBe(1);
  });
  it("M36 unknown calib falls back to aligned", () => {
    expect(normState({ calib: "evil" }).calib).toBe("aligned");
  });
  it("M37 M38 keeps the NEWEST log/feelLog entries", () => {
    const n = normState({
      log: Array.from({ length: 600 }, (_, i) => ({ q: "q" + i, at: i })),
      feelLog: Array.from({ length: 30 }, (_, i) => ({ feel: 1, mine: 1, at: i })),
    });
    expect(n.log[0]!.at).toBe(100);
    expect(n.feelLog[0]!.at).toBe(10);
  });
  it("M39 log tag capped at 24", () => expect(normState({ log: [{ tag: "t".repeat(50), at: 1 }] }).log[0]!.tag).toHaveLength(24));
  it("M40 feel clamped at 0", () => expect(normState({ feel: -5 }).feel).toBe(0));
  it("M45 equal last -> larger streak in both orders", () => {
    const b = normState({ streak: 2, last: "2026-01-05" }), c = normState({ streak: 3, last: "2026-01-05" });
    expect(mergeStates(c, b).streak).toBe(3);
  });
  it("M46 same question answered twice at different times keeps both log entries", () => {
    const e = (at: number) => ({ q: "a", t: 6, tag: "m", gave: "du", at });
    expect(mergeStates(normState({ log: [e(1)] }), normState({ log: [e(2)] })).log).toHaveLength(2);
  });
  it("M58 M59 a mostly-retired topic never tops up above the allowed tier", () => {
    const s = emptyState(); s.crowns[6] = 0;
    for (const q of BANK) if (q.t === 6 && q.tier === 1) s.seen[qid(q)] = 3;
    for (let i = 0; i < 50; i++) {
      const out = pickQuestions(BANK, s, 6, "normal", seeded(i + 1));
      expect(out).toHaveLength(8);
      expect(out.filter((q) => q.t === 6 && q.tier > 1)).toHaveLength(0);
    }
  });
  it("M61 M62 weakTag picks the worst rule regardless of key order, strictly below 60%", () => {
    const s = emptyState();
    s.hist = { f: [0, 3], m: [1, 3] };
    expect(weakTag(s)).toBe("f");
    s.hist = { m: [3, 2] };
    expect(weakTag(s)).toBeNull();
  });
  it("M67 normal round leads with fixes for the weak rule", () => {
    const s = emptyState(); s.hist = { v: [0, 5] };
    for (let i = 0; i < 20; i++) expect(pickQuestions(BANK, s, 6, "normal", seeded(i + 1)).filter((q) => q.tag === "v").length).toBeGreaterThanOrEqual(3);
  });
  it("M64 harder serves 4 hard questions of strong rules", () => {
    const s = emptyState(); s.hist = { m: [9, 0] }; s.calib = "harder";
    const out = pickQuestions(BANK, s, 6, "weak", seeded(5));
    expect(out.filter((q) => q.tag === "m" && (q.tier >= 4 || q.k !== "choice")).length).toBeGreaterThanOrEqual(4);
  });
  it("M65 proof never serves tier 4+ of a strong rule", () => {
    const s = emptyState(); s.hist = { m: [9, 0], f: [9, 0], v: [9, 0] }; s.calib = "proof";
    for (let i = 0; i < 30; i++) {
      const out = pickQuestions(BANK, s, 6, "weak", seeded(i + 1));
      expect(out.filter((q) => ["m", "f", "v"].includes(q.tag) && q.tier > 3 && q.k === "choice")).toHaveLength(0);
    }
  });
  it("M70 own exactly half earns a crown", () => {
    const s = emptyState(); s.crowns[6] = 0;
    expect(scoreRound(s, round({ questions: [...qs(4), ...qs(4, 3)] }), "2026-10-24").crowned).toBe(true);
  });
  it("M72 no crown from a weak round", () => {
    const s = emptyState(); s.crowns[6] = 0;
    expect(scoreRound(s, round({ mode: "weak" }), "2026-10-24").crowned).toBe(false);
  });
  it("M74 M75 croissant needs perfect AND 8 questions", () => {
    const s = emptyState();
    scoreRound(s, round({ right: 7 }), "2026-10-24");
    scoreRound(s, round({ right: 6, questions: qs(6) }), "2026-10-24");
    expect(s.cro).toBe(0);
  });
  it("M78-M81 calibFor boundaries", () => {
    expect(calibFor(25, 50)).toBe("proof"); // gap -25, mine 50
    expect(calibFor(30, 50)).toBe("more"); // gap -20
    expect(calibFor(65, 50)).toBe("harder"); // gap 15
    expect(calibFor(50, 60)).toBe("aligned"); // gap -10
  });
  it("M82-M85 myRate exact values", () => {
    const all = (tag: string) => Array.from({ length: 8 }, () => ({ tag, ok: true }));
    expect(myRate(normState({ hist: { m: [5, 5] } }), all("m"))).toBe(65); // 0.6+0.2=80 -> cap 65
    expect(myRate(normState({ hist: { m: [8, 2] } }), all("m"))).toBe(85); // 60+32=92 -> cap 85
    expect(myRate(normState({ hist: { m: [0, 1], f: [20, 0] } }), [...all("m"), ...all("f")])).toBe(98); // m has 1 attempt: no cap
    expect(myRate(normState({ hist: { m: [20, 0] } }), [{ tag: "m", ok: true }, { tag: "m", ok: false }])).toBe(70); // 30+40
  });
  it("M16 M17 accentsOnly false when ok or for fix", () => {
    const b = BANK.find((q) => q.k === "en2fr" && /[éèêàç]/.test(q.a))!;
    expect(accentsOnly(b, b.a, true)).toBe(false);
    const f = BANK.find((q) => q.k === "fix")!;
    expect(accentsOnly(f, f.a, false)).toBe(false);
  });
  it("M88 M89 M91 M92 contract bounds", () => {
    expect(() => CoachRoundBody.parse({ focus: Array(7).fill("m") })).toThrow();
    expect(() => CoachRoundResponse.parse({ fallback: false, questions: BANK.slice(0, 3) })).toThrow();
    expect(() => ProgressResponse.parse({ state: {}, version: -1 })).toThrow();
    expect(() => CoachExplainBody.parse({ qid: "x".repeat(401), gave: "" })).toThrow();
  });
  it("M03 M04 schema rejects broken questions", () => {
    expect(Question.safeParse({ t: 6, tier: 1, k: "choice", tag: "m", a: "du", s: "x ___", o: ["de"] }).success).toBe(false);
    expect(Question.safeParse({ t: 6, tier: 1, k: "fix", tag: "m", a: "x", s: "y" }).success).toBe(false);
  });
  it("M76 dayBefore in a UTC+ zone (run with TZ=Asia/Kolkata)", () => {
    expect(dayBefore("2026-10-24")).toBe("2026-10-23");
  });
});
