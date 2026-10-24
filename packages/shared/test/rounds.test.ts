import { describe, expect, it } from "vitest";
import { BANK, qid } from "@cq/content";
import {
  calibFor, dayBefore, emptyState, myRate, normState, pickQuestions, retired, ruleSplit, scoreRound, weakTag, xpFor,
} from "../src/index.js";

// deterministic rng
const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

describe("scoring", () => {
  it("xp is 10 then 13 and caps: 8 right in a row earn 163", () => {
    expect(xpFor(1)).toBe(10);
    expect(xpFor(2)).toBe(13);
    let total = 0;
    for (let c = 1; c <= 8; c++) total += xpFor(c);
    expect(total).toBe(163);
  });
});

describe("weakTag / ruleSplit", () => {
  it("needs 3 attempts under 60%", () => {
    const s = emptyState();
    s.hist = { m: [0, 2] };
    expect(weakTag(s)).toBeNull();
    s.hist = { m: [1, 3], f: [0, 3] };
    expect(weakTag(s)).toBe("f");
  });
  it("splits at 90% with 2+ attempts", () => {
    const s = emptyState();
    s.hist = { m: [9, 1], f: [1, 1], v: [5, 0] };
    const { strong, weak } = ruleSplit(s);
    expect(strong.sort()).toEqual(["m", "v"]);
    expect(weak).toEqual(["f"]);
  });
});

describe("pickQuestions", () => {
  it("always ships 8 questions at every crown level and never above the allowed tier [fixed #9]", () => {
    for (let crown = 0; crown < 5; crown++) {
      const s = emptyState();
      s.crowns[6] = crown;
      for (let i = 0; i < 100; i++) {
        const qs = pickQuestions(BANK, s, 6, "normal", seeded(i + 1));
        expect(qs).toHaveLength(8);
        expect(qs.filter((q) => q.t === 6 && q.tier > Math.min(5, crown + 1))).toHaveLength(0);
      }
    }
  });
  it("[fixed #8] an outstanding miss stays drillable after 3 views", () => {
    const s = emptyState();
    const q = BANK.find((x) => x.t === 6 && x.k === "choice")!;
    s.seen[qid(q)] = 3; s.wrong[qid(q)] = 1;
    expect(retired(s, [q])).toHaveLength(0);
    let hit = false;
    for (let i = 0; i < 20; i++) if (pickQuestions(BANK, s, 6, "weak", seeded(i + 1)).includes(q)) hit = true;
    expect(hit).toBe(true);
  });
  it("[fixed #18] the review pick favours the most-missed earlier question", () => {
    const s = emptyState();
    const rev = BANK.filter((q) => q.t === 3);
    const target = rev[4]!;
    s.wrong[qid(target)] = 9;
    for (let i = 0; i < 30; i++) {
      const qs = pickQuestions(BANK, s, 6, "normal", seeded(i + 100));
      expect(qs).toContain(target);
    }
  });
  it("weak mode on a fresh state still returns a full round (no dead Weak Spots / Drill)", () => {
    expect(pickQuestions(BANK, emptyState(), 6, "weak", seeded(7))).toHaveLength(8);
  });
  it("proof mode serves choice questions of mastered rules at tier <= 3", () => {
    const s = emptyState();
    s.hist = { m: [9, 0], f: [9, 0], v: [9, 0] };
    s.calib = "proof";
    const qs = pickQuestions(BANK, s, 6, "weak", seeded(3));
    expect(qs).toHaveLength(8);
    expect(qs.filter((q) => ["m", "f", "v"].includes(q.tag) && q.k === "choice" && q.tier <= 3).length).toBeGreaterThanOrEqual(6);
  });
});

describe("scoreRound", () => {
  const qs = (n: number, t = 6) => Array.from({ length: n }, () => ({ t }));
  const round = (o: object) => ({ topic: 6, mode: "normal" as const, hearts: 5, right: 8, questions: qs(8), ...o });
  it("crowns at n-1 right below crown 3 and needs all right from crown 3", () => {
    const s = emptyState(); s.crowns[6] = 0;
    expect(scoreRound(s, round({ right: 7 }), "2026-10-24").crowned).toBe(true);
    s.crowns[6] = 3;
    expect(scoreRound(s, round({ right: 7 }), "2026-10-24").crowned).toBe(false);
    expect(scoreRound(s, round({ right: 8 }), "2026-10-24").crowned).toBe(true);
    expect(s.crowns[6]).toBe(4);
  });
  it("[fixed #9] no crown without enough of the topic's own questions, none out of hearts, none past 5", () => {
    const s = emptyState(); s.crowns[6] = 0;
    expect(scoreRound(s, round({ questions: qs(8, 3) }), "2026-10-24").crowned).toBe(false);
    expect(scoreRound(s, round({ hearts: 0 }), "2026-10-24").crowned).toBe(false);
    s.crowns[6] = 5;
    expect(scoreRound(s, round({}), "2026-10-24").crowned).toBe(false);
  });
  it("a perfect full round earns a croissant; a 4-question AI round does not [fixed #20]", () => {
    const s = emptyState();
    scoreRound(s, round({}), "2026-10-24");
    expect(s.cro).toBe(1);
    scoreRound(s, round({ mode: "ai", right: 4, questions: qs(4) }), "2026-10-24");
    expect(s.cro).toBe(1);
  });
  it("streak: +1 on consecutive days, resets after a gap, unchanged on the same day", () => {
    const s = emptyState();
    scoreRound(s, round({}), "2026-10-24");
    expect(s.streak).toBe(1);
    scoreRound(s, round({}), "2026-10-24");
    expect(s.streak).toBe(1);
    scoreRound(s, round({}), "2026-10-25");
    expect(s.streak).toBe(2);
    scoreRound(s, round({}), "2026-10-28");
    expect(s.streak).toBe(1);
    expect(s.rounds).toBe(4);
  });
  it("[fixed #20] yesterday is calendar arithmetic, safe across DST and month/year ends", () => {
    expect(dayBefore("2026-03-30")).toBe("2026-03-29");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
  });
});

describe("feel meter", () => {
  it("calibFor: proof / harder / more / aligned", () => {
    expect(calibFor(10, 70)).toBe("proof");
    expect(calibFor(10, 30)).toBe("more");
    expect(calibFor(80, 60)).toBe("harder");
    expect(calibFor(60, 55)).toBe("aligned");
  });
  it("myRate blends round and record and is capped by the worst rule", () => {
    const s = normState({ hist: { m: [1, 9] } });
    const all = Array.from({ length: 8 }, () => ({ tag: "m", ok: true }));
    expect(myRate(s, all)).toBeLessThanOrEqual(65);
    expect(myRate(emptyState(), all)).toBe(100);
    expect(myRate(emptyState(), [])).toBe(0);
  });
});
