"use strict";
// Lane C behaviour tests. Drives only the page's public surface (submit, saveAll,
// endRound, quit button onclick, pickQuestions, boot) and asserts on observable
// outcomes: persisted state, screens shown, score, which questions are served.
// Usage: node C-behave.js            (original page)
//        C_FILE=/path/mutant.html node C-behave.js
// Exit code 1 if any non-xfail test fails. xfail = a prior-audit hypothesis the
// suite encodes as the CORRECT behaviour; it is expected to fail today.
const assert = require("assert");
const { load, ORIG } = require("./C-harness");
const FILE = process.env.C_FILE || ORIG;
const L = o => load(Object.assign({ file: FILE }, o));
const results = [];
function test(name, fn, opts = {}) {
  return { name, fn, xfail: !!opts.xfail };
}
const tests = [];
const T = (n, f, o) => tests.push(test(n, f, o));
const XT = (n, f) => tests.push(test(n, f, { xfail: true }));
const tick = async g => { for (let i = 0; i < 6; i++) await g.tick(); };
const freshRound = (g, topic = 6, mode = "normal") => { g.P.startRound(topic, mode); return g.P.R; };

/* ---------- answering ---------- */
T("a right answer scores 10 then 13 xp, builds combo, and persists to localStorage", () => {
  const g = L(); freshRound(g);
  g.answer("right"); g.flush();
  assert.strictEqual(g.P.S.xp, 10);
  g.answer("right");
  assert.strictEqual(g.P.S.xp, 23);
  assert.strictEqual(g.P.R.combo, 2);
  assert.strictEqual(JSON.parse(g.store.get("croissant-quest-v1")).xp, 23);
});
T("xp bonus caps: 8 right in a row earn 163 total", () => {
  const g = L(); freshRound(g); g.play("r");
  assert.strictEqual(g.P.S.xp, 163);
});
T("a wrong answer costs a heart, resets combo, earns no xp, and queues the question as missed", () => {
  const g = L(); const R = freshRound(g);
  g.answer("right"); g.flush();
  const q = R.qs[R.i], id = g.P.qid(q), xp = g.P.S.xp;
  g.answer("wrong");
  assert.strictEqual(R.hearts, 4); assert.strictEqual(R.combo, 0);
  assert.strictEqual(g.P.S.xp, xp);
  assert.strictEqual(g.P.S.wrong[id], 1);
});
T("answering the same question twice in one tap is ignored (double submit)", () => {
  const g = L(); const R = freshRound(g);
  g.answer("right"); const xp = g.P.S.xp; R.picked = R.qs[R.i].a; g.P.submit();
  assert.strictEqual(g.P.S.xp, xp); assert.strictEqual(R.right, 1);
});
T("a right answer works a previously-missed question's miss count back down and then clears it", () => {
  const g = L(); const R = freshRound(g); const q = R.qs[0], id = g.P.qid(q);
  g.P.S.wrong[id] = 2; g.answer("right");
  assert.strictEqual(g.P.S.wrong[id], 1);
  R.answered = false; R.i = 0; g.answer("right");
  assert.ok(!(id in g.P.S.wrong));
});
T("each answered question is counted in S.seen", () => {
  const g = L(); const R = freshRound(g); const id = g.P.qid(R.qs[0]);
  g.answer("right"); assert.strictEqual(g.P.S.seen[id], 1);
});
T("a question answered three times is retired from normal rounds", () => {
  const g = L(); const R = freshRound(g); const q = R.qs[0];
  for (let i = 0; i < 3; i++) { R.answered = false; R.i = 0; g.answer("right"); }
  assert.strictEqual(g.P.seenN(q), 3);
  for (let i = 0; i < 25; i++) assert.ok(!g.P.pickQuestions(6, "normal").includes(q), "retired question served");
});
T("tag history records right and wrong separately", () => {
  const g = L(); const R = freshRound(g); const tag = R.qs[0].tag;
  const before = (g.P.S.hist[tag] || [0, 0]).slice();
  g.answer("right"); g.flush(); const h = g.P.S.hist[tag];
  assert.deepStrictEqual([h[0] - before[0], h[1] - before[1]], [1, 0]);
});
T("typed answer: accents-only miss is wrong but typing the whole answer in caps/space noise is right", () => {
  const g = L(); const R = freshRound(g);
  const q = { t: 6, k: "type", s: "Je mange ___ pain.", a: "Je mange du pain.", en: "x", tag: "t" };
  R.qs[0] = q; R.picked = "  JE MANGE DU PAIN  "; assert.strictEqual(g.P.judge(q), true);
  R.picked = "du"; assert.strictEqual(g.P.judge(q), true, "blank-only reading");
  R.picked = "de la"; assert.strictEqual(g.P.judge(q), false);
});
T("choice answers are exact-match", () => {
  const g = L(); freshRound(g);
  const q = { t: 6, k: "choice", s: "___ eau", a: "de l'", o: ["du", "de l'"], en: "", tag: "t" };
  g.P.R.picked = "de l'"; assert.ok(g.P.judge(q)); g.P.R.picked = "du"; assert.ok(!g.P.judge(q));
});
T("ending on hearts: 5 wrong answers end the round early with 'Out of hearts' and no crown", () => {
  const g = L(); freshRound(g); g.play("w");
  assert.strictEqual(g.node("#scr-done").hidden, false);
  assert.strictEqual(g.node("#d-title").textContent, "Out of hearts");
  assert.ok(!g.P.S.crowns[6]);
});

/* ---------- saving ---------- */
T("saveAll writes the whole state to localStorage and survives a reload", () => {
  const g = L(); g.P.S.xp = 77; g.P.S.crowns[6] = 2; g.P.saveAll();
  const g2 = L({ local: { "croissant-quest-v1": g.store.get("croissant-quest-v1") } });
  assert.strictEqual(g2.P.S.xp, 77); assert.strictEqual(g2.P.S.crowns[6], 2);
  assert.strictEqual(g2.P.S.crowns[1], 5, "mastered topics stay mastered");
});
T("saveAll does not throw when storage is full/blocked", () => {
  const g = L({ lsThrows: true }); g.P.S.xp = 1; assert.doesNotThrow(() => g.P.saveAll());
});
T("saveAll trims log to last 120 and feelLog to last 20 in the db copy", async () => {
  const g = L({ db: null }); await tick(g);
  g.P.S.log = Array.from({ length: 150 }, (_, i) => ({ i })); g.P.S.feelLog = Array.from({ length: 30 }, (_, i) => i);
  g.doc_writes.length = 0; g.P.saveAll(); await tick(g);
  const b = g.doc_writes.at(-1); assert.strictEqual(b.log.length, 120); assert.strictEqual(b.log[0].i, 30);
  assert.strictEqual(b.feelLog.length, 20); assert.strictEqual(b.feelLog[0], 10);
});
T("db copy carries xp, cro, streak, crowns, wrong, seen, hist, calib", async () => {
  const g = L({ db: null }); await tick(g);
  Object.assign(g.P.S, { xp: 5, cro: 2, streak: 3, calib: "harder" }); const id = g.P.qid(g.P.BANK[0]); g.P.S.seen.k = 2; g.P.S.wrong[id] = 1; g.P.S.hist.t = [1, 2];
  g.P.saveAll(); await tick(g); const b = g.doc_writes.at(-1);
  assert.deepStrictEqual([b.xp, b.cro, b.streak, b.calib, b.seen.k, b.wrong[id], b.hist.t], [5, 2, 3, "harder", 2, 1, [1, 2]]);
});
T("every answer is committed immediately (reload mid-round keeps the xp)", () => {
  const g = L(); freshRound(g); g.answer("right");
  assert.strictEqual(JSON.parse(g.store.get("croissant-quest-v1")).xp, 10);
});
T("answer after boot with a db: the db doc receives the answer's xp", async () => {
  const g = L({ db: { xp: 40, crowns: { 1: 5 } } }); await tick(g);
  freshRound(g); g.answer("right"); await tick(g);
  assert.strictEqual(g.doc_writes.at(-1).xp, 50);
});

/* ---------- ending a round ---------- */
T("7/8 on topic 6 with hearts left earns crown 1; a perfect round also earns a croissant and results show", () => {
  const g = L(); freshRound(g); g.play("rrrrrrrr");
  assert.strictEqual(g.P.S.crowns[6], 1); assert.strictEqual(g.P.S.cro, 1); assert.strictEqual(g.P.S.rounds, 1);
  assert.strictEqual(g.node("#scr-done").hidden, false); assert.strictEqual(g.node("#scr-round").hidden, true);
  assert.strictEqual(g.node("#d-title").textContent, "Crown earned!");
  assert.strictEqual(g.node("#d-acc").textContent, "8/8");
  assert.strictEqual(g.node("#d-xp").textContent, "+163");
});
T("exactly one miss still earns a crown while the topic has under 3 crowns", () => {
  const g = L(); freshRound(g); g.play("rwrrrrrr");
  assert.strictEqual(g.P.S.crowns[6], 1); assert.ok(!g.P.S.cro);
});
T("two misses earns no crown but the round is counted", () => {
  const g = L(); freshRound(g); g.play("rwrwrrrr");
  assert.ok(!g.P.S.crowns[6]); assert.strictEqual(g.P.S.rounds, 1);
  assert.strictEqual(g.node("#d-title").textContent, "Round complete");
});
T("from crown 3 up a crown needs a perfect round", () => {
  const g = L(); g.P.S.crowns[6] = 3; freshRound(g); g.play("rwrrrrrr");
  assert.strictEqual(g.P.S.crowns[6], 3);
  const h = L(); h.P.S.crowns[6] = 3; freshRound(h); h.play("rrrrrrrr");
  assert.strictEqual(h.P.S.crowns[6], 4);
});
T("crowns never exceed 5", () => {
  const g = L(); g.P.S.crowns[6] = 5; freshRound(g); g.play("rrrrrrrr");
  assert.strictEqual(g.P.S.crowns[6], 5);
});
T("a weak-spots round never awards a topic crown", () => {
  const g = L(); const q = g.P.BANK.find(q => q.t === 6); g.P.S.wrong[g.P.qid(q)] = 2;
  freshRound(g, 6, "weak"); g.play("r");
  assert.ok(!g.P.S.crowns[6]); assert.strictEqual(g.P.S.rounds, 1);
});
T("first round ever starts a streak of 1; next-day round makes 2; a gap resets to 1; same day does not double count", () => {
  const g = L(); freshRound(g); g.play("r"); assert.strictEqual(g.P.S.streak, 1);
  const d0 = g.P.S.last; assert.match(d0, /^2026-10-24$/);
  g.setNow(Date.UTC(2026, 9, 24, 15)); freshRound(g); g.play("r"); assert.strictEqual(g.P.S.streak, 1, "same day");
  g.setNow(Date.UTC(2026, 9, 25, 12)); freshRound(g); g.play("r"); assert.strictEqual(g.P.S.streak, 2, "next day");
  g.setNow(Date.UTC(2026, 9, 28, 12)); freshRound(g); g.play("r"); assert.strictEqual(g.P.S.streak, 1, "gap");
});
T("ending a round saves to localStorage and the db doc", async () => {
  const g = L({ db: null }); await tick(g); freshRound(g); g.play("r"); await tick(g);
  const ls = JSON.parse(g.store.get("croissant-quest-v1")); assert.strictEqual(ls.rounds, 1);
  assert.strictEqual(g.doc_writes.at(-1).rounds, 1); assert.strictEqual(g.doc_writes.at(-1).crowns[6], 1);
});
T("results screen still appears if scoring blows up (safely isolation)", () => {
  const g = L(); freshRound(g); g.P.R.qs = null;      // score step will throw
  assert.doesNotThrow(() => g.P.endRound());
  assert.strictEqual(g.node("#scr-done").hidden, false);
});

/* ---------- quit ---------- */
T("quit hides the round and shows the map, with no crown or round counted", () => {
  const g = L(); freshRound(g); g.answer("right"); g.flush();
  g.node("#btn-quit").onclick();
  assert.strictEqual(g.node("#scr-round").hidden, true); assert.strictEqual(g.node("#scr-map").hidden, false);
  assert.ok(!g.P.S.crowns[6]); assert.strictEqual(g.P.S.rounds, 0);
});
T("quit keeps the xp already earned", () => {
  const g = L(); freshRound(g); g.answer("right"); g.node("#btn-quit").onclick();
  assert.strictEqual(g.P.S.xp, 10);
  assert.strictEqual(JSON.parse(g.store.get("croissant-quest-v1")).xp, 10);
});
T("[fixed #5] after quit, a pending end-of-round timer must not crown or show results", () => {
  const g = L(); freshRound(g);
  for (let i = 0; i < 8; i++) { g.answer("right"); if (i < 7) g.flush(); }
  // last answer's 3.4s auto-advance is pending; player taps X now
  g.node("#btn-quit").onclick(); g.flush();
  assert.ok(!g.P.S.crowns[6], "crown awarded after quit");
  assert.strictEqual(g.node("#scr-done").hidden, true, "results screen surfaced after quit");
});

/* ---------- question picking ---------- */
const topic6 = g => g.P.BANK.filter(q => q.t === 6);
T("a round has 8 distinct questions", () => {
  const g = L(); const qs = g.P.pickQuestions(6, "normal");
  assert.strictEqual(qs.length, 8); assert.strictEqual(new Set(qs).size, 8);
});
T("never serves a retired (3x seen) question while enough fresh ones exist", () => {
  const g = L(); const t6 = topic6(g);
  t6.slice(0, 100).forEach(q => g.P.S.seen[g.P.qid(q)] = 3);
  for (let i = 0; i < 25; i++) for (const q of g.P.pickQuestions(6, "normal")) assert.ok(g.P.seenN(q) < 3, "served retired: " + g.P.qid(q));
});
T("seen count of 2 is still live (cap is at 3)", () => {
  const g = L(); const t1 = topic6(g).filter(q => q.tier <= 1);
  t1.forEach(q => g.P.S.seen[g.P.qid(q)] = 3); const keep = t1.slice(0, 8); keep.forEach(q => g.P.S.seen[g.P.qid(q)] = 2);
  const ids = new Set(keep); const qs = g.P.pickQuestions(6, "normal");
  assert.ok(qs.filter(q => ids.has(q)).length >= 6, "live questions skipped");
});
T("when everything is retired the round is still a full 8 (never a short round)", () => {
  const g = L(); g.P.BANK.forEach(q => g.P.S.seen[g.P.qid(q)] = 3);
  assert.strictEqual(g.P.pickQuestions(6, "normal").length, 8);
});
T("first-crown round draws from the topic and earlier topics only, at tier 1 for the topic", () => {
  const g = L();
  for (let i = 0; i < 20; i++) for (const q of g.P.pickQuestions(6, "normal")) assert.ok(q.t <= 6 && (q.t < 6 || q.tier <= 1) || q.t === 6, "bad pick");
  for (let i = 0; i < 20; i++) assert.ok(g.P.pickQuestions(6, "normal").filter(q => q.t === 6).every(q => q.tier <= 1), "topic-6 question above target tier");
});
T("higher crowns unlock higher tiers (crown 4 -> tier 5 appears)", () => {
  const g = L(); g.P.S.crowns[6] = 4; let hit = false;
  for (let i = 0; i < 30; i++) if (g.P.pickQuestions(6, "normal").some(q => q.t === 6 && q.tier === 5)) hit = true;
  assert.ok(hit);
});
T("weak mode leads with the player's missed questions", () => {
  const g = L(); const ms = topic6(g).filter(q => q.tier === 2).slice(0, 3); ms.forEach(q => g.P.S.wrong[g.P.qid(q)] = 2);
  const qs = g.P.pickQuestions(6, "weak"); ms.forEach(q => assert.ok(qs.includes(q)));
  assert.strictEqual(qs.length, 8);
});
const weakCand = g => Object.keys(g.P.TAG).find(t => g.P.BANK.filter(q => q.tag === t).length >= 4);
T("a weak rule (<60% over 3+ tries) puts at least 3 of its questions in a normal round", () => {
  const g = L(); const wt = weakCand(g); assert.ok(wt, "no taggable rule in bank");
  g.P.S.hist[wt] = [0, 5]; assert.strictEqual(g.P.weakTag(), wt);
  const qs = g.P.pickQuestions(6, "normal"); assert.ok(qs.filter(q => q.tag === wt).length >= 3);
});
T("a rule under 3 tries is not 'weak' yet", () => {
  const g = L(); const wt = weakCand(g); g.P.S.hist[wt] = [0, 2]; assert.strictEqual(g.P.weakTag(), null);
});
T("starting a normal round with a weak rule shows the boss card first; its button then starts the round", () => {
  const g = L(); const wt = weakCand(g); g.P.S.hist[wt] = [0, 5];
  g.P.startRound(6, "normal"); assert.strictEqual(g.P.R, null);
  const walk = n => { for (const c of n.children) { if (c.onclick && /Chasse/.test(c.textContent)) return c; const r = walk(c); if (r) return r; } return null; };
  const b = walk(g.node("#sheetroot")); assert.ok(b, "boss card has no start button"); b.onclick();
  assert.ok(g.P.R && g.P.R.qs.length === 8);
});
T("startRound shows the round screen and hides the map", () => {
  const g = L(); freshRound(g);
  assert.strictEqual(g.node("#scr-round").hidden, false); assert.strictEqual(g.node("#scr-map").hidden, true);
  assert.strictEqual(g.P.R.hearts, 5);
});

/* ---------- boot ---------- */
T("boot with nothing stored starts fresh with topics 1-5 mastered", () => {
  const g = L(); const S = g.P.S;
  assert.deepStrictEqual([S.xp, S.rounds, S.streak], [0, 0, 0]);
  for (let t = 1; t <= 5; t++) assert.strictEqual(S.crowns[t], 5);
});
T("boot restores local state", () => {
  const g = L({ local: { "croissant-quest-v1": JSON.stringify({ xp: 321, streak: 4, crowns: { 6: 2 } }) } });
  assert.strictEqual(g.P.S.xp, 321); assert.strictEqual(g.P.S.streak, 4);
});
T("boot survives corrupt local storage", () => {
  const g = L({ local: { "croissant-quest-v1": "{not json" } }); assert.strictEqual(g.P.S.xp, 0);
});
T("boot with a db save: db state is adopted, mutable, and later saves go to the db", async () => {
  const g = L({ db: { xp: 900, crowns: { 6: 3 }, calib: "bogus", wrong: { a: 1 } } }); await tick(g);
  assert.strictEqual(g.P.S.xp, 900); assert.strictEqual(g.P.S.crowns[6], 3);
  assert.strictEqual(g.P.S.calib, "aligned", "unknown calib is repaired");
  assert.strictEqual(g.P.S.crowns[1], 5);
  assert.ok(g.P.SAVEDOC);
  g.P.S.crowns[7] = 1; g.P.S.log.push({ a: 1 });          // would throw if frozen
  g.P.saveAll(); assert.strictEqual(g.doc_writes.at(-1).xp, 900);
});
T("boot with an empty db creates the save doc from local state", async () => {
  const g = L({ db: null, local: { "croissant-quest-v1": JSON.stringify({ xp: 12 }) } }); await tick(g);
  assert.ok(g.P.SAVEDOC); assert.strictEqual(g.doc_writes.at(-1).xp, 12);
});
T("before the db read lands, answers are saved locally but NOT written to the db (no xp-0 overwrite)", async () => {
  const g = L({ dbPending: true }); await tick(g);
  assert.strictEqual(g.P.SAVEDOC, null);
  freshRound(g); g.answer("right"); await tick(g);
  assert.strictEqual(g.doc_writes.length, 0);
  assert.strictEqual(JSON.parse(g.store.get("croissant-quest-v1")).xp, 10);
});
T("[fixed #4] a device copy newer than the db copy must not be lost on boot", async () => {
  const g = L({ db: { xp: 100 }, local: { "croissant-quest-v1": JSON.stringify({ xp: 500 }) } }); await tick(g);
  assert.ok(g.P.S.xp >= 500, "xp went " + g.P.S.xp);
});
T("[fixed #6] a question answered wrong 3 times and still outstanding in S.wrong must not be retired", () => {
  const g = L(); const R = freshRound(g); const q = R.qs[0], id = g.P.qid(q);
  for (let i = 0; i < 3; i++) { R.answered = false; R.i = 0; R.hearts = 5; g.answer("wrong"); }
  assert.ok(g.P.S.wrong[id] >= 1);
  assert.strictEqual(g.P.retired([q]).length, 0, "retired after 3 WRONG answers while still missed (seen=" + g.P.seenN(q) + ")");
});
T("[fixed #7] topic-6 crown must not be awardable by a round with no topic-6 questions", () => {
  const g = L(); g.P.BANK.filter(q => q.t === 6).forEach(q => g.P.S.seen[g.P.qid(q)] = 3);
  freshRound(g); g.play("r");
  assert.ok(!g.P.S.crowns[6] || g.P.R.qs.some(q => q.t === 6), "crown " + g.P.S.crowns[6] + " with topic-6 questions in round: " + g.P.R.qs.filter(q => q.t === 6).length);
});

/* ---------- run ---------- */
(async () => {
  let fail = 0, xf = 0, xpass = 0;
  for (const t of tests) {
    try { await t.fn(); results.push([t, "pass"]); }
    catch (e) { results.push([t, "fail", e.message.split("\n")[0]]); }
  }
  for (const [t, r, m] of results) {
    if (t.xfail) { if (r === "fail") { xf++; console.log("XFAIL (confirmed) " + t.name + "  -- " + m); } else { xpass++; console.log("XPASS (not reproduced) " + t.name); } }
    else if (r === "fail") { fail++; console.log("FAIL " + t.name + "  -- " + m); }
    else console.log("ok   " + t.name);
  }
  console.log(`\n${results.length - fail - xf - xpass} passed, ${fail} failed, ${xf} xfail-confirmed, ${xpass} xpass (of ${results.length})`);
  process.exit(fail ? 1 : 0);
})();
