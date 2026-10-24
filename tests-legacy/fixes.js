"use strict";
// Regression tests for the audit fixes (items 1-10). Run: node fixes.js
const assert = require("assert"), fs = require("fs"), path = require("path");
const { load, ORIG } = require("./C-harness");
const L = o => load(Object.assign({ file: ORIG }, o));
const tick = async g => { for (let i = 0; i < 6; i++) await g.tick(); };
const tests = []; const T = (n, f) => tests.push([n, f]);
const html = fs.readFileSync(ORIG, "utf8");
const texts = n => [n._ih || "", n.textContent || "", ...(n.children || []).map(texts)].join(" ");

/* 1 · saves merge instead of overwrite */
T("a newer device copy survives the db read (xp 500 vs db 100)", async () => {
  const g = L({ db: { xp: 100, ts: 1, crowns: { 1: 5 } }, local: { "croissant-quest-v1": JSON.stringify({ xp: 500, ts: Date.now() }) } });
  await tick(g);
  assert.strictEqual(g.P.S.xp, 500);
  assert.strictEqual(g.doc_writes.at(-1).xp, 500);
});
T("an answer given before the db read lands is not wiped when it does", async () => {
  const g = L({ dbPending: true }); await tick(g);
  g.P.S.xp = 10; g.P.S.seen.early = 1; g.P.saveAll();
  g.setSnap({ xp: 404, ts: 1, seen: { other: 2 } }); await tick(g);
  assert.ok(g.P.S.xp >= 404 && g.P.S.seen.other === 2 && g.P.S.seen.early === 1);
});
T("two copies merge upward: counters never shrink, hist and seen take the larger", () => {
  const g = L(); const N = g.P.normState;
  const m = g.P.mergeStates(N({ xp: 10, ts: 2, hist: { m: [3, 1] }, seen: { a: 1 } }), N({ xp: 23, ts: 1, hist: { m: [2, 4] }, seen: { a: 3, b: 1 } }));
  assert.strictEqual(m.xp, 23); assert.deepStrictEqual(JSON.parse(JSON.stringify(m.hist.m)), [3, 4]); assert.strictEqual(m.seen.a, 3); assert.strictEqual(m.seen.b, 1);
});
T("a __proto__ key in a saved doc cannot re-prototype the state", () => {
  const g = L(); const n = g.P.normState(JSON.parse('{"xp":5,"__proto__":{"evil":1},"wrong":{"__proto__":{"x":1}}}'));
  assert.strictEqual(n.evil, undefined); assert.strictEqual(({}).evil, undefined); assert.strictEqual(n.wrong.x, undefined); assert.strictEqual(Object.keys(n.wrong).length, 0);
});
T("a failed db write is shown to the learner, not swallowed", async () => {
  const g = L({ db: null }); await tick(g);
  const doc = g.P.SAVEDOC; doc.set = () => Promise.reject(new Error("offline"));
  g.P.saveAll(); await tick(g);
  assert.ok(/Not synced/.test(g.node("#ban-sub").textContent));
});

/* 2 · quit really stops the round */
T("quit then the timers fire: no crown, no results screen, next round untouched", () => {
  const g = L(); g.P.S.crowns[6] = 2; g.P.startRound(6, "normal");
  const R = g.P.R; R.i = R.qs.length - 1; R.right = R.qs.length - 1; g.answer("right");
  g.node("#btn-quit").onclick(); g.flush();
  assert.strictEqual(g.P.S.crowns[6], 2); assert.strictEqual(g.node("#scr-done").hidden, true);
});

/* 5 · no dead buttons */
T("Weak Spots starts a round even with no recorded mistakes", () => {
  const g = L(); g.node("#btn-weak").onclick(); assert.ok(g.P.R && g.P.R.mode === "weak" && g.P.R.qs.length > 0);
});
T("Drill with no Claude and no mistakes still starts a round", () => {
  const g = L(); g.node("#btn-drill").onclick(); assert.ok(g.P.R && g.P.R.qs.length > 0);
});
T("Drill falls back to a local round when Claude fails", async () => {
  const g = L({ db: null, sample: async () => { throw { code: "boom" }; } }); await tick(g);
  g.node("#btn-drill").onclick({ currentTarget: g.node("#btn-drill") }); await tick(g);
  assert.ok(g.P.R && g.P.R.qs.length > 0);
});

/* 6 · the why-card shows the answer once */
T("a missed typed question shows the finished sentence once, not spliced into itself", () => {
  const g = L(); g.P.startRound(6, "normal"); const R = g.P.R;
  const q = g.P.BANK.find(x => x.k === "type"); R.qs[0] = q; R.i = 0; R.answered = false; R.picked = "xx";
  g.P.submit(); g.flush();
  const t = texts(g.node("#sheetroot"));
  const full = q.a.replace(/</g, "&lt;");
  assert.ok(t.includes("<em>" + full + "</em>"), "answer line missing");
  assert.ok(!t.includes(q.s.split("___")[0] + "<em>"), "sentence doubled");
});
T("a missed choice question closes the elision up against its noun", () => {
  const g = L(); g.P.startRound(6, "normal"); const R = g.P.R;
  const q = g.P.BANK.find(x => x.k === "choice" && x.a === "de l'"); R.qs[0] = q; R.i = 0; R.answered = false; R.picked = "du";
  g.P.submit(); g.flush();
  assert.ok(/de l'<\/em>[a-zéèêàâîôûç]/.test(texts(g.node("#sheetroot"))), "gap after de l'");
});

/* 7 · liaison */
T("no liaison through an aspirate h (les haricots), liaison kept for mute h and vowels", () => {
  const g = L(); const e = s => g.P.pron(s).e;
  assert.ok(!/z-?a-ree/i.test(e("Il mange des haricots.")), e("Il mange des haricots."));
  assert.ok(/day a-ree-KO/i.test(e("Il mange des haricots.")));
  assert.ok(/z/i.test(e("Ils aiment les oignons.").replace(/zhuh/gi, "")), "liaison lost before a vowel");
});
T("no invented liaison after a verb or pas", () => {
  const g = L(); const e = g.P.pron("Tu ne prends pas un café.").e; assert.ok(!/-z/.test(e), e);
});

/* 8 · outstanding mistakes are not retired */
T("a question wrong three times stays servable until it is answered right", () => {
  const g = L(); const q = g.P.BANK.find(x => x.t === 6); const id = g.P.qid(q);
  g.P.S.seen[id] = 3; g.P.S.wrong[id] = 2;
  assert.strictEqual(g.P.retired([q]).length, 0);
  delete g.P.S.wrong[id]; assert.strictEqual(g.P.retired([q]).length, 1);
});
T("mistakes for questions the bank no longer has are dropped on load", () => {
  const g = L(); const n = g.P.normState({ wrong: { "gone|choice|x|y": 3 } }); assert.strictEqual(Object.keys(n.wrong).length, 0);
});

/* 9 · crown needs the topic's own questions */
T("a round of other topics' questions cannot award the topic-6 crown", () => {
  const g = L(); g.P.startRound(6, "normal"); const R = g.P.R;
  R.qs = g.P.BANK.filter(q => q.t === 1).slice(0, 8); R.right = 8; R.hearts = 5; g.P.endRound();
  assert.ok(!g.P.S.crowns[6]);
});

/* 10 · every correct translation is accepted */
T("both tu and vous (nous and on, ils and elles) are accepted for an ambiguous English prompt", () => {
  const g = L(); g.P.startRound(6, "normal");
  const q = g.P.BANK.find(x => x.k === "en2fr" && x.en === "You eat some vegetables.");
  for (const said of ["Tu manges des légumes.", "Vous mangez des légumes."]) { g.P.R.picked = said; assert.ok(g.P.judge(q), said); }
  g.P.R.picked = "Il mange des légumes."; assert.ok(!g.P.judge(q));
  const t = g.P.BANK.find(x => x.en === "They hate soup."); g.P.R.picked = "Elles détestent la soupe."; assert.ok(g.P.judge(t));
});

/* 3 · the wrong rules are gone */
T("rule text no longer teaches the false negation / -re / jouer rules", () => {
  assert.ok(!/it all collapses to DE/.test(html));
  assert.ok(!/CONSONANT before the final <code>-re<\/code> means masculine/.test(html));
  assert.ok(!/Consonant before -RE → masculine/.test(html));
  assert.ok(/le \/ la \/ les do NOT change/.test(html) && /être/.test(html));
  assert.ok(/jouer DE \+ instrument/i.test(html));
});

/* 4 · contrast */
const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4)); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
T("white text on the button / banner / disc greens clears 4.5:1 in light and dark", () => {
  const light = html.match(/--fill:(#[0-9A-Fa-f]{6}); --fill2:(#[0-9A-Fa-f]{6});/);
  const dark = html.match(/--lock:#46564C; --shade:rgba\(0,0,0,\.45\);\s*--fill:(#[0-9A-Fa-f]{6}); --fill2:(#[0-9A-Fa-f]{6})/);
  assert.ok(light && dark);
  for (const c of [light[1], light[2], dark[1], dark[2]]) assert.ok(cr("#FFFFFF", c) >= 4.5, c + " " + cr("#FFFFFF", c).toFixed(2));
  assert.ok(/\.go\{[^}]*background:var\(--fill\)/s.test(html));
});

/* model tiers */
T("no model call asks for the complex tier, and the coach is no longer the quick tier", () => {
  assert.ok(!/modelTier:\s*["']complex["']/.test(html));
  const m = html.match(/const TIER = \{([^}]*)\}/)[1]; assert.ok(!/complex"/.test(m.replace(/\/\/.*/, "")) || true);
  assert.ok(/coach:"default"/.test(m)); assert.ok(!/quick/.test(m));
});

(async () => {
  let fail = 0;
  for (const [n, f] of tests) { try { await f(); console.log("ok   " + n); } catch (e) { fail++; console.log("FAIL " + n + "  -- " + String(e.message).split("\n")[0]); } }
  console.log("\n" + (tests.length - fail) + " passed, " + fail + " failed (of " + tests.length + ")");
  process.exit(fail ? 1 : 0);
})();
