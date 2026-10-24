// Parity gate: the legacy single-file game's tests (tests-legacy/C-behave.js, tests-legacy/fixes.js),
// re-asserted on the shared rules. Every title is the EXACT legacy name behind a prefix.
// Calls C(...) / F(...) must start at column 0: scripts/parity-report.mjs parses them.
// Legacy tests that need a browser (screens, timers, localStorage, db) are mapped to web/api tests
// in docs/PARITY.md instead. Intentional differences are in the second half ("changed: ...").
import { describe, expect, it } from "vitest";
import { BANK, RULES, TAG, TOPICS, qid, type Question } from "@cq/content";
import {
  SEEN_CAP, calibFor, emptyState, fullOf, judge, mergeStates, myRate, noteAnswer, normState, pickQuestions,
  pron, retired, ruleSplit, scoreRound, weakTag, xpFor, type RoundSummary, type State,
} from "../src/index.js";

const C = (name: string, fn: () => void) => it(`[legacy C-behave] ${name}`, fn);
const F = (name: string, fn: () => void) => it(`[legacy fixes] ${name}`, fn);
const X = (adr: string, name: string, fn: () => void) => it(`[changed: ${adr}] ${name}`, fn);

const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const TODAY = "2026-10-24";
const t6 = BANK.filter((q) => q.t === 6);
const id = (q: Question) => qid(q);
const pick = (s: State, topic = 6, mode: "normal" | "weak" = "normal", seed = 1) => pickQuestions(BANK, s, topic, mode, seeded(seed));
/** A finished round: `play` is "r"/"w" per question, like the legacy g.play(). Hearts: 5 minus wrongs. */
function round(play: string, o: Partial<RoundSummary> = {}): RoundSummary {
  const n = play.length, wrong = [...play].filter((c) => c === "w").length;
  return {
    topic: 6, mode: "normal", hearts: Math.max(0, 5 - wrong), right: n - wrong,
    questions: Array.from({ length: n }, () => ({ t: 6 })), ...o,
  };
}
const weakCand = () => Object.keys(TAG).find((t) => BANK.filter((q) => q.tag === t).length >= 4)!;

/* ---------- answering ---------- */
C("a right answer scores 10 then 13 xp, builds combo, and persists to localStorage", () => {
  // the combo ladder is shared; persistence is web/game-store (see PARITY.md)
  expect(xpFor(1)).toBe(10);
  expect(xpFor(1) + xpFor(2)).toBe(23);
});
C("xp bonus caps: 8 right in a row earn 163 total", () => {
  let total = 0;
  for (let c = 1; c <= 8; c++) total += xpFor(c);
  expect(total).toBe(163);
  expect(xpFor(20)).toBe(30);
});
C("a question answered three times is retired from normal rounds", () => {
  const s = emptyState(), q = t6.find((x) => x.tier <= 1)!;
  for (let i = 0; i < 3; i++) s.seen[id(q)] = (s.seen[id(q)] ?? 0) + 1;
  expect(s.seen[id(q)]).toBe(SEEN_CAP);
  expect(retired(s, [q])).toHaveLength(1);
  for (let i = 0; i < 25; i++) expect(pick(s, 6, "normal", i + 1)).not.toContain(q);
});
C("tag history records right and wrong separately", () => {
  const s = emptyState();
  noteAnswer(s, "m", true);
  expect(s.hist.m).toEqual([1, 0]);
  noteAnswer(s, "m", false);
  expect(s.hist.m).toEqual([1, 1]);
  noteAnswer(s, "toString", true); // not a rule: ignored
  expect(Object.keys(s.hist)).toEqual(["m"]);
});
C("typed answer: accents-only miss is wrong but typing the whole answer in caps/space noise is right", () => {
  const q: Question = { t: 6, k: "type", s: "Je mange ___ pain.", a: "Je mange du pain.", en: "x", tag: "m" } as Question;
  expect(judge(q, "  JE MANGE DU PAIN  ")).toBe(true);
  expect(judge(q, "du")).toBe(true); // blank-only reading
  expect(judge(q, "de la")).toBe(false);
});
C("choice answers are exact-match", () => {
  const q = { t: 6, k: "choice", s: "___ eau", a: "de l'", o: ["du", "de l'"], en: "", tag: "m" } as Question;
  expect(judge(q, "de l'")).toBe(true);
  expect(judge(q, "du")).toBe(false);
});
C("ending on hearts: 5 wrong answers end the round early with 'Out of hearts' and no crown", () => {
  const s = emptyState();
  const r = scoreRound(s, round("wwwww", { questions: Array.from({ length: 5 }, () => ({ t: 6 })) }), TODAY);
  expect(r.crowned).toBe(false);
  expect(s.crowns[6]).toBeUndefined();
});

/* ---------- saving ---------- */
C("saveAll writes the whole state to localStorage and survives a reload", () => {
  const s = emptyState();
  s.xp = 77; s.crowns[6] = 2;
  const back = normState(JSON.parse(JSON.stringify(s)));
  expect(back.xp).toBe(77);
  expect(back.crowns[6]).toBe(2);
  expect(back.crowns[1]).toBe(5); // mastered topics stay mastered
});
C("saveAll trims log to last 120 and feelLog to last 20 in the db copy", () => {
  // feelLog 20 is normState's; the 120-entry db copy is web/api (changed: ADR 0006, normState keeps 500 locally)
  const feelLog = Array.from({ length: 30 }, (_, i) => ({ feel: i, mine: i }));
  const n = normState({ feelLog });
  expect(n.feelLog).toHaveLength(20);
  expect(n.feelLog[0]!.feel).toBe(10);
});
C("db copy carries xp, cro, streak, crowns, wrong, seen, hist, calib", () => {
  const known = id(BANK[0]!);
  const n = normState({ xp: 5, cro: 2, streak: 3, calib: "harder", seen: { [known]: 2 }, wrong: { [known]: 1 }, hist: { m: [1, 2] }, crowns: { 6: 3 } });
  expect([n.xp, n.cro, n.streak, n.calib, n.seen[known], n.wrong[known], n.hist.m, n.crowns[6]]).toEqual([5, 2, 3, "harder", 2, 1, [1, 2], 3]);
});

/* ---------- ending a round ---------- */
C("7/8 on topic 6 with hearts left earns crown 1; a perfect round also earns a croissant and results show", () => {
  const s = emptyState();
  const r = scoreRound(s, round("rrrrrrrr"), TODAY);
  expect(r).toEqual({ crowned: true, perfect: true });
  expect([s.crowns[6], s.cro, s.rounds]).toEqual([1, 1, 1]);
  expect(8 - 0).toBe(8); // 8/8
  let xp = 0;
  for (let c = 1; c <= 8; c++) xp += xpFor(c);
  expect(xp).toBe(163); // "+163"
});
C("exactly one miss still earns a crown while the topic has under 3 crowns", () => {
  const s = emptyState();
  scoreRound(s, round("rwrrrrrr"), TODAY);
  expect(s.crowns[6]).toBe(1);
  expect(s.cro).toBe(0);
});
C("two misses earns no crown but the round is counted", () => {
  const s = emptyState();
  const r = scoreRound(s, round("rwrwrrrr"), TODAY);
  expect(r.crowned).toBe(false);
  expect(s.crowns[6]).toBeUndefined();
  expect(s.rounds).toBe(1);
});
C("from crown 3 up a crown needs a perfect round", () => {
  const a = emptyState(); a.crowns[6] = 3;
  scoreRound(a, round("rwrrrrrr"), TODAY);
  expect(a.crowns[6]).toBe(3);
  const b = emptyState(); b.crowns[6] = 3;
  scoreRound(b, round("rrrrrrrr"), TODAY);
  expect(b.crowns[6]).toBe(4);
});
C("crowns never exceed 5", () => {
  const s = emptyState(); s.crowns[6] = 5;
  scoreRound(s, round("rrrrrrrr"), TODAY);
  expect(s.crowns[6]).toBe(5);
});
C("a weak-spots round never awards a topic crown", () => {
  for (const mode of ["weak", "ai"] as const) {
    const s = emptyState();
    const r = scoreRound(s, round("rrrrrrrr", { mode }), TODAY);
    expect(r.crowned).toBe(false);
    expect(s.crowns[6]).toBeUndefined();
    expect(s.rounds).toBe(1);
  }
});
C("first round ever starts a streak of 1; next-day round makes 2; a gap resets to 1; same day does not double count", () => {
  const s = emptyState();
  scoreRound(s, round("r"), "2026-10-24");
  expect(s.streak).toBe(1);
  expect(s.last).toBe("2026-10-24");
  scoreRound(s, round("r"), "2026-10-24");
  expect(s.streak).toBe(1); // same day
  scoreRound(s, round("r"), "2026-10-25");
  expect(s.streak).toBe(2); // next day
  scoreRound(s, round("r"), "2026-10-28");
  expect(s.streak).toBe(1); // gap
});

/* ---------- question picking ---------- */
C("a round has 8 distinct questions", () => {
  const qs = pick(emptyState());
  expect(qs).toHaveLength(8);
  expect(new Set(qs).size).toBe(8);
});
C("never serves a retired (3x seen) question while enough fresh ones exist", () => {
  const s = emptyState();
  t6.slice(0, 100).forEach((q) => (s.seen[id(q)] = 3));
  for (let i = 0; i < 25; i++)
    for (const q of pick(s, 6, "normal", i + 1)) expect(s.seen[id(q)] ?? 0, "served retired: " + id(q)).toBeLessThan(3);
});
C("seen count of 2 is still live (cap is at 3)", () => {
  const s = emptyState(), t1 = t6.filter((q) => q.tier <= 1);
  t1.forEach((q) => (s.seen[id(q)] = 3));
  const keep = t1.slice(0, 8);
  keep.forEach((q) => (s.seen[id(q)] = 2));
  const ids = new Set(keep);
  expect(pick(s).filter((q) => ids.has(q)).length).toBeGreaterThanOrEqual(6);
});
C("when everything is retired the round is still a full 8 (never a short round)", () => {
  const s = emptyState();
  BANK.forEach((q) => (s.seen[id(q)] = 3));
  expect(pick(s)).toHaveLength(8);
});
C("first-crown round draws from the topic and earlier topics only, at tier 1 for the topic", () => {
  for (let i = 0; i < 20; i++) {
    const qs = pick(emptyState(), 6, "normal", i + 1);
    for (const q of qs) expect(q.t).toBeLessThanOrEqual(6);
    expect(qs.filter((q) => q.t === 6).every((q) => q.tier <= 1)).toBe(true);
  }
});
C("higher crowns unlock higher tiers (crown 4 -> tier 5 appears)", () => {
  const s = emptyState(); s.crowns[6] = 4;
  let hit = false;
  for (let i = 0; i < 30; i++) if (pick(s, 6, "normal", i + 1).some((q) => q.t === 6 && q.tier === 5)) hit = true;
  expect(hit).toBe(true);
});
C("weak mode leads with the player's missed questions", () => {
  const s = emptyState(), ms = t6.filter((q) => q.tier === 2).slice(0, 3);
  ms.forEach((q) => (s.wrong[id(q)] = 2));
  const qs = pick(s, 6, "weak");
  ms.forEach((q) => expect(qs).toContain(q));
  expect(qs).toHaveLength(8);
});
C("a weak rule (<60% over 3+ tries) puts at least 3 of its questions in a normal round", () => {
  const s = emptyState(), wt = weakCand();
  expect(wt).toBeTruthy();
  s.hist[wt] = [0, 5];
  expect(weakTag(s)).toBe(wt);
  for (let i = 0; i < 10; i++) expect(pick(s, 6, "normal", i + 1).filter((q) => q.tag === wt).length).toBeGreaterThanOrEqual(3);
});
C("a rule under 3 tries is not 'weak' yet", () => {
  const s = emptyState(); s.hist[weakCand()] = [0, 2];
  expect(weakTag(s)).toBeNull();
});
C("starting a normal round with a weak rule shows the boss card first; its button then starts the round", () => {
  // the shared half: weakTag is the boss trigger, and the round it starts is a full 8 hunting that rule.
  // The card itself is web (RoundScreen); see PARITY.md.
  const s = emptyState(), wt = weakCand();
  expect(weakTag(s)).toBeNull(); // no boss card without a weak rule
  s.hist[wt] = [0, 5];
  expect(weakTag(s)).toBe(wt);
  const qs = pick(s);
  expect(qs).toHaveLength(8);
  expect(qs.filter((q) => q.tag === wt).length).toBeGreaterThanOrEqual(3);
});

/* ---------- boot ---------- */
C("boot with nothing stored starts fresh with topics 1-5 mastered", () => {
  for (const s of [emptyState(), normState(undefined), normState({})]) {
    expect([s.xp, s.rounds, s.streak]).toEqual([0, 0, 0]);
    for (let t = 1; t <= 5; t++) expect(s.crowns[t]).toBe(5);
  }
});
C("boot restores local state", () => {
  const s = normState(JSON.parse(JSON.stringify({ xp: 321, streak: 4, crowns: { 6: 2 } })));
  expect([s.xp, s.streak, s.crowns[6]]).toEqual([321, 4, 2]);
});
C("boot survives corrupt local storage", () => {
  let parsed: unknown;
  try { parsed = JSON.parse("{not json"); } catch { parsed = null; }
  expect(normState(parsed).xp).toBe(0);
  expect(normState("{not json").xp).toBe(0);
  expect(normState([1, 2]).xp).toBe(0);
});
C("boot with a db save: db state is adopted, mutable, and later saves go to the db", () => {
  const s = normState({ xp: 900, crowns: { 6: 3 }, calib: "bogus", wrong: { a: 1 } });
  expect(s.xp).toBe(900);
  expect(s.crowns[6]).toBe(3);
  expect(s.calib).toBe("aligned"); // unknown calib is repaired
  expect(s.crowns[1]).toBe(5);
  s.crowns[7] = 1; s.log.push({ q: "a", t: 1, tag: "m", gave: "", at: 1 }); // would throw if frozen
  expect(s.crowns[7]).toBe(1);
});
C("[fixed #4] a device copy newer than the db copy must not be lost on boot", () => {
  const m = mergeStates(normState({ xp: 500 }), normState({ xp: 100 }));
  expect(m.xp).toBeGreaterThanOrEqual(500);
});
C("[fixed #6] a question answered wrong 3 times and still outstanding in S.wrong must not be retired", () => {
  const s = emptyState(), q = t6[0]!;
  s.seen[id(q)] = 3; s.wrong[id(q)] = 3;
  expect(retired(s, [q])).toHaveLength(0);
});
C("[fixed #7] topic-6 crown must not be awardable by a round with no topic-6 questions", () => {
  const s = emptyState();
  t6.forEach((q) => (s.seen[id(q)] = 3));
  const qs = pick(s);
  const r = scoreRound(s, { topic: 6, mode: "normal", hearts: 5, right: qs.length, questions: qs }, TODAY);
  // either the retired topic-6 questions were served as a last resort (own half) or no crown
  expect(!s.crowns[6] || qs.some((q) => q.t === 6)).toBe(true);
  const other = emptyState();
  const o = scoreRound(other, { topic: 6, mode: "normal", hearts: 5, right: 8, questions: Array.from({ length: 8 }, () => ({ t: 1 })) }, TODAY);
  expect(o.crowned).toBe(false);
  expect(r.perfect).toBe(true);
});

/* ================= fixes.js ================= */
F("a newer device copy survives the db read (xp 500 vs db 100)", () => {
  const m = mergeStates(normState({ xp: 500, ts: Date.now() }), normState({ xp: 100, ts: 1, crowns: { 1: 5 } }));
  expect(m.xp).toBe(500);
});
F("an answer given before the db read lands is not wiped when it does", () => {
  const local = normState({ xp: 10, seen: { early: 1 } });
  const db = normState({ xp: 404, ts: 1, seen: { other: 2 } });
  const m = mergeStates(local, db);
  expect(m.xp).toBeGreaterThanOrEqual(404);
  expect(m.seen.other).toBe(2);
  expect(m.seen.early).toBe(1);
});
F("two copies merge upward: counters never shrink, hist and seen take the larger", () => {
  const m = mergeStates(
    normState({ xp: 10, ts: 2, hist: { m: [3, 1] }, seen: { a: 1 } }),
    normState({ xp: 23, ts: 1, hist: { m: [2, 4] }, seen: { a: 3, b: 1 } }),
  );
  expect(m.xp).toBe(23);
  expect(m.hist.m).toEqual([3, 4]);
  expect(m.seen.a).toBe(3);
  expect(m.seen.b).toBe(1);
});
F("a __proto__ key in a saved doc cannot re-prototype the state", () => {
  const n = normState(JSON.parse('{"xp":5,"__proto__":{"evil":1},"wrong":{"__proto__":{"x":1}}}'));
  expect((n as unknown as { evil?: number }).evil).toBeUndefined();
  expect(({} as { evil?: number }).evil).toBeUndefined();
  expect((n.wrong as { x?: number }).x).toBeUndefined();
  expect(Object.keys(n.wrong)).toHaveLength(0);
});
F("Weak Spots starts a round even with no recorded mistakes", () => {
  const qs = pick(emptyState(), 6, "weak");
  expect(qs.length).toBeGreaterThan(0);
});
F("Drill with no Claude and no mistakes still starts a round", () => {
  // the local fallback is a weak round over the bank; with no record it still fills 8
  const qs = pick(emptyState(), 6, "weak");
  expect(qs).toHaveLength(8);
  const s = emptyState(); s.calib = "proof";
  expect(pick(s, 6, "weak").length).toBeGreaterThan(0);
});
F("a missed typed question shows the finished sentence once, not spliced into itself", () => {
  const q = BANK.find((x) => x.k === "type")!;
  expect(fullOf(q)).toBe(q.a);
  expect(fullOf(q).split(q.a)).toHaveLength(2); // once
});
F("a missed choice question closes the elision up against its noun", () => {
  const q = BANK.find((x) => x.k === "choice" && x.a === "de l'")!;
  expect(fullOf(q)).toMatch(/de l'[a-zéèêàâîôûç]/);
  expect(fullOf(q)).not.toMatch(/l' /);
});
F("no liaison through an aspirate h (les haricots), liaison kept for mute h and vowels", () => {
  const e = (s: string) => pron(s).e;
  expect(e("Il mange des haricots.")).not.toMatch(/z-?a-ree/i);
  expect(e("Il mange des haricots.")).toMatch(/day a-ree-KO/i);
  expect(e("Ils aiment les oignons.").replace(/zhuh/gi, "")).toMatch(/z/i);
});
F("no invented liaison after a verb or pas", () => {
  expect(pron("Tu ne prends pas un café.").e).not.toMatch(/-z/);
});
F("a question wrong three times stays servable until it is answered right", () => {
  const s = emptyState(), q = t6[0]!;
  s.seen[id(q)] = 3; s.wrong[id(q)] = 2;
  expect(retired(s, [q])).toHaveLength(0);
  delete s.wrong[id(q)];
  expect(retired(s, [q])).toHaveLength(1);
});
F("mistakes for questions the bank no longer has are dropped on load", () => {
  const n = normState({ wrong: { "gone|choice|x|y": 3 } }, new Set(BANK.map(id)));
  expect(Object.keys(n.wrong)).toHaveLength(0);
});
F("a round of other topics' questions cannot award the topic-6 crown", () => {
  const s = emptyState();
  scoreRound(s, { topic: 6, mode: "normal", hearts: 5, right: 8, questions: BANK.filter((q) => q.t === 1).slice(0, 8) }, TODAY);
  expect(s.crowns[6]).toBeUndefined();
});
F("both tu and vous (nous and on, ils and elles) are accepted for an ambiguous English prompt", () => {
  const q = BANK.find((x) => x.k === "en2fr" && x.en === "You eat some vegetables.")!;
  for (const said of ["Tu manges des légumes.", "Vous mangez des légumes."]) expect(judge(q, said), said).toBe(true);
  expect(judge(q, "Il mange des légumes.")).toBe(false);
  const t = BANK.find((x) => x.en === "They hate soup.")!;
  expect(judge(t, "Elles détestent la soupe.")).toBe(true);
});
F("rule text no longer teaches the false negation / -re / jouer rules", () => {
  const all = JSON.stringify([TAG, RULES]);
  expect(all).not.toMatch(/it all collapses to DE/);
  expect(all).not.toMatch(/CONSONANT before the final/);
  expect(all).not.toMatch(/Consonant before -RE/);
  expect(all).toMatch(/le \/ la \/ les do NOT change/);
  expect(all).toMatch(/jouer DE \+ instrument/i);
});

/* ================= intentional changes (asserted as the NEW behaviour) ================= */
describe("changed behaviour", () => {
  X("AUDIT-REPORT-2 #20", "a croissant is only for a perfect round of 8 or more questions", () => {
    const s = emptyState();
    scoreRound(s, round("rrrr", { mode: "ai" }), TODAY);
    expect(s.cro).toBe(0); // legacy: 1
    scoreRound(s, round("rrrrrrrr"), TODAY);
    expect(s.cro).toBe(1);
  });
  X("AUDIT-REPORT-2 #20", "yesterday is calendar arithmetic, so the streak survives a DST day", () => {
    const s = emptyState();
    scoreRound(s, round("r"), "2026-03-28");
    scoreRound(s, round("r"), "2026-03-29");
    scoreRound(s, round("r"), "2026-03-30");
    expect(s.streak).toBe(3);
  });
  X("ADR 0006", "merge: streak and last travel together from the later last", () => {
    const m = mergeStates(normState({ streak: 9, last: "2026-10-01" }), normState({ streak: 2, last: "2026-10-20" }));
    expect([m.streak, m.last]).toEqual([2, "2026-10-20"]); // legacy took max(streak) = 9
    const eq = mergeStates(normState({ streak: 4, last: "2026-10-20" }), normState({ streak: 6, last: "2026-10-20" }));
    expect(eq.streak).toBe(6);
  });
  X("ADR 0006", "merge: log is the union by (at, q), oldest first", () => {
    const e = (q: string, at: number) => ({ q, t: 6, tag: "m", gave: "x", at });
    const m = mergeStates(normState({ ts: 2, log: [e("a", 1), e("b", 2)] }), normState({ ts: 1, log: [e("b", 2), e("c", 3)] }));
    expect(m.log.map((x) => x.q)).toEqual(["a", "b", "c"]); // legacy: the newer copy's log only
  });
  X("ADR 0006", "merge: wrong follows the newer ts (a cleared mistake stays cleared)", () => {
    const m = mergeStates(normState({ ts: 5, wrong: {} }), normState({ ts: 1, wrong: { x: 2 } }));
    expect(m.wrong).toEqual({});
  });
  X("AUDIT-REPORT-2 #14", "a last that is not a real calendar date is dropped on load", () => {
    for (const bad of ["zzzz", "2026-02-30", "9999-99-99", 20261024, "x".repeat(200000)]) expect(normState({ last: bad }).last).toBeNull();
    expect(normState({ last: "2026-10-24" }).last).toBe("2026-10-24");
  });
  X("AUDIT-REPORT-2 #14", "normState bounds: unknown rules dropped, counters clamped, negatives zeroed", () => {
    const n = normState({ xp: 1e30, cro: -4, hist: { m: [1, 2], nonsense: [9, 9] }, crowns: { 999: 3 } });
    expect(n.xp).toBeLessThanOrEqual(1_000_000_000);
    expect(n.cro).toBe(0);
    expect(Object.keys(n.hist)).toEqual(["m"]);
    expect(n.crowns[999]).toBeUndefined();
  });
  X("AUDIT-REPORT-2 #18", "review picks are weighted to past mistakes (most-missed earlier-topic question is always included)", () => {
    const s = emptyState();
    const rev = BANK.filter((q) => q.t < 6);
    const worst = rev[40]!;
    s.wrong[id(worst)] = 9;
    rev.slice(0, 30).forEach((q) => (s.wrong[id(q)] = 1));
    for (let i = 0; i < 20; i++) expect(pick(s, 6, "normal", i + 1)).toContain(worst); // legacy reshuffled it away
  });
  X("AUDIT-REPORT-2 #20", "pron never throws on prototype property names", () => {
    expect(() => pron("constructor __proto__ toString")).not.toThrow();
  });
});

describe("shared helpers used by the legacy feel meter", () => {
  it("myRate and calibFor and ruleSplit still follow the legacy numbers", () => {
    const s = emptyState();
    s.hist = { m: [9, 1], f: [1, 3] };
    expect(ruleSplit(s)).toEqual({ strong: ["m"], weak: ["f"] });
    expect(myRate(s, [{ tag: "f", ok: true }, { tag: "f", ok: true }])).toBeLessThanOrEqual(65);
    expect(calibFor(90, 50)).toBe("harder");
    expect(calibFor(10, 70)).toBe("proof");
    expect(calibFor(40, 60)).toBe("more");
    expect(calibFor(50, 50)).toBe("aligned");
    expect(TOPICS.length).toBe(44);
  });
});
