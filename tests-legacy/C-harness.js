"use strict";
// Lane C harness: load the <script> of a Croissant Quest html file into node's vm
// with DOM / localStorage / artifact (window.claude) stubs. Reusable:
//   const {load} = require('./C-harness'); const g = load({file, db, sample, local});
// Returns a handle exposing page internals (S, R, BANK, functions) via an
// accessor block appended INSIDE the script (so top-level let/const are visible).
const fs = require("fs"), vm = require("vm"), path = require("path");
const ORIG = path.join(__dirname, "..", "croissant-quest.html");

function mkNode(sel) {
  const n = {
    _sel: sel, hidden: false, textContent: "", _ih: "", className: "", disabled: false,
    style: new Proxy({}, {get:(t,k)=>k in t?t[k]:(typeof k==='string'?()=>{}:undefined)}), dataset: {}, children: [], value: "", onclick: null, id: "",
    classList: { _s: new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)}, contains(c){return this._s.has(c)}, toggle(c){this._s.has(c)?this._s.delete(c):this._s.add(c)} },
    get innerHTML(){ return this._ih; }, set innerHTML(v){ this._ih = v; if (v === "") this.children = []; },
    appendChild(c){ this.children.push(c); return c; }, append(...c){ this.children.push(...c); },
    remove(){}, focus(){}, select(){}, setAttribute(k,v){this[k]=v}, getAttribute(k){return this[k]??null},
    addEventListener(){}, removeEventListener(){},
    querySelector(s){ return mkNode(s); }, querySelectorAll(){ return []; },
    getBoundingClientRect(){ return {left:0,top:0,width:10,height:10}; },
    getContext(){ return new Proxy({}, {get:(t,k)=>k in t?t[k]:()=>{}, set:(t,k,v)=>{t[k]=v;return true}}); },
    scrollIntoView(){}, closest(){return null}, insertBefore(c){this.children.push(c)},
  };
  return n;
}

function load(opts = {}) {
  const file = opts.file || ORIG;
  let html = fs.readFileSync(file, "utf8");
  const m = html.match(/<script>([\s\S]*)<\/script>\s*<\/body>/) || html.match(/<script>([\s\S]*?)<\/script>/);
  let src = m[1];
  if (opts.patch) src = opts.patch(src);
  src += `
;globalThis.__P = {
  get S(){return S}, set S(v){S=v}, get R(){return R}, set R(v){R=v},
  get DB(){return DB}, get SAVEDOC(){return SAVEDOC}, get SAMPLE(){return SAMPLE},
  BANK, TOPICS, qid, judge, submit, endRound, saveAll, loadLocal, pickQuestions, startRound,
  launchRound, boot, renderQ, next, fullOf, seenN, weakTag, norm, drawMap, pron, LS, SEEN_CAP,
  tagStats, noteAnswer, topicState, TAG, retired, live, normState, mergeStates
};`;
  const nodes = {};
  const timers = []; let tid = 0, now = Date.UTC(2026, 9, 24, 12, 0, 0);
  const store = new Map(Object.entries(opts.local || {}));
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => { if (opts.lsThrows) throw new Error("quota"); store.set(k, String(v)); },
    removeItem: k => store.delete(k),
  };
  const document = {
    querySelector: s => nodes[s] || (nodes[s] = mkNode(s)),
    querySelectorAll: () => [],
    getElementById: id => nodes["#" + id] || (nodes["#" + id] = mkNode("#" + id)),
    createElement: t => mkNode(t),
    documentElement: mkNode("html"), body: mkNode("body"), execCommand(){ return true; },
    addEventListener(){},
  };
  const doc_writes = [];       // every SAVEDOC.set body
  const dbState = { snap: opts.db === undefined ? undefined : opts.db, waiters: [] };
  const snapOf = () => ({ exists: dbState.snap !== null, data: () => dbState.snap && Object.freeze(JSON.parse(JSON.stringify(dbState.snap))) });
  const savedoc = {
    // a read issued before setSnap() stays pending until setSnap() releases it
    get: () => dbState.snap === undefined ? new Promise(r => dbState.waiters.push(r)).then(snapOf) : Promise.resolve(snapOf()),
    set: b => { doc_writes.push(JSON.parse(JSON.stringify(b))); return Promise.resolve(); },
  };
  let sample = null;
  if (opts.sample) {
    sample = async () => ""; sample.json = opts.sample;
  }
  const claude = (opts.db !== undefined || opts.dbPending || opts.sample) ? {
    use: async name => name === "db" ? (opts.db === undefined && !opts.dbPending ? null : { doc: () => savedoc }) : name === "sample" ? sample : null,
  } : undefined;
  const win = {
    document, localStorage, console: opts.quiet === false ? console : { log(){}, error(){}, warn(){} },
    matchMedia: () => ({ matches: false, addEventListener(){} }),
    navigator: { vibrate(){} }, innerWidth: 400, innerHeight: 800, devicePixelRatio: 1,
    scrollTo(){}, requestAnimationFrame: f => 0, cancelAnimationFrame(){},
    setTimeout: (f, ms) => { timers.push({ id: ++tid, f, at: now + (ms | 0) }); return tid; },
    clearTimeout: id => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
    setInterval: () => ++tid, clearInterval(){},
    Date: class extends Date { constructor(...a){ a.length ? super(...a) : super(now); } static now(){ return now; } },
    AudioContext: undefined, Math, JSON, Object, Array, Set, Map, Promise, String, Number, Error, RegExp,
    addEventListener(){}, getComputedStyle: () => ({ getPropertyValue: () => "" }),
    window: null, claude,
  };
  win.window = win; win.globalThis = win; win.self = win;
  const ctx = vm.createContext(win);
  vm.runInContext(src, ctx, { filename: path.basename(file) });
  const P = ctx.__P;
  return {
    P, ctx, nodes, doc_writes, store, timers, win,
    node: s => document.querySelector(s),
    setSnap(s){ dbState.snap = s; dbState.waiters.splice(0).forEach(r => r()); },
    // run all pending timers (optionally only those due), awaiting nothing
    flush(max = 50) { let n = 0; while (timers.length && n++ < max) { timers.sort((a,b)=>a.at-b.at); const t = timers.shift(); now = Math.max(now, t.at); t.f(); } },
    advance(ms) { const end = now + ms; for (;;) { timers.sort((a,b)=>a.at-b.at); if (!timers.length || timers[0].at > end) break; const t = timers.shift(); now = Math.max(now, t.at); t.f(); } now = end; },
    setNow(t){ now = t; },
    // find the visible "Got it" button of the open wrong-answer sheet and tap it
    tapGotIt() {
      const walk = n => { for (const c of n.children) { if (c.textContent === "Got it" && c.onclick) return c; const r = walk(c); if (r) return r; } return null; };
      const b = walk(document.querySelector("#sheetroot")); if (!b) return false; b.onclick(); return true;
    },
    // Play a whole round: pattern like "rrrwrrrr" (r = right, w = wrong), repeating last char.
    play(pattern) {
      let guard = 0;
      for (;;) {
        const R = P.R; if (!R || R.i >= R.qs.length || guard++ > 40) break;
        const how = pattern[Math.min(R.i, pattern.length - 1)] === "w" ? "wrong" : "right";
        const before = R.i; this.answer(how); this.flush(); if (how === "wrong") this.tapGotIt(); this.flush();
        if (nodes["#scr-done"] && nodes["#scr-done"].hidden === false) break;
        if (R.i === before && R.hearts > 0 && R.i < R.qs.length) break;
      }
    },
    tick: () => new Promise(r => setImmediate(r)),
    // Play the question at R.i. how: 'right' | 'wrong'. Uses ONLY the public
    // surface the UI uses: set the picked value, press submit().
    answer(how) {
      const R = P.R, q = R.qs[R.i];
      if (q.k === "fix") { R.badWords = q.bad.split(" "); R.picked = how === "right" ? q.bad.split(" ")[0] : "__nope__"; }
      else R.picked = how === "right" ? q.a : "zzz-wrong";
      R.pickedEl = null;
      P.submit();
    },
  };
}
module.exports = { load, ORIG };
