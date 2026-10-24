import { describe, expect, it } from "vitest";
import { emptyState, mergeStates, noteAnswer, normState, ruleSplit, tagStats, weakTag } from "../src/index.js";

const wellFormed = (s: string) => !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe("last is a real YYYY-MM-DD date or null (D-api-2, C-shared-4, K-3)", () => {
  it("rejects anything else: junk, a 200k string, impossible dates, trailing space", () => {
    for (const last of ["9999-12-31x", "~", "z".repeat(200_000), "2026-02-30", "2026-13-01", "2026-10-24 ", "26-10-24", "2026-1-05", 20261024])
      expect(normState({ last, streak: 5 }).last, String(last).slice(0, 20)).toBeNull();
  });
  it("keeps a valid date, including a leap day", () => {
    expect(normState({ last: "2026-10-24" }).last).toBe("2026-10-24");
    expect(normState({ last: "2028-02-29" }).last).toBe("2028-02-29");
  });
  it("a malformed copy no longer wins the merge", () => {
    const bad = normState({ last: "zzz", streak: 1 });
    const good = normState({ last: "2026-10-25", streak: 9 });
    const m = mergeStates(bad, good);
    expect([m.last, m.streak]).toEqual(["2026-10-25", 9]);
  });
});

describe("strings are well-formed and NUL-free (K-4)", () => {
  it("an emoji cut at 60 UTF-16 units in gave leaves no lone surrogate", () => {
    const cut = ("a".repeat(59) + "🥐").slice(0, 60); // ends in a lone high surrogate
    expect(wellFormed(cut)).toBe(false);
    const n = normState({ log: [{ q: cut, t: 6, tag: "m", gave: cut, at: 1 }] });
    expect(wellFormed(n.log[0]!.gave)).toBe(true);
    expect(wellFormed(n.log[0]!.q)).toBe(true);
    expect(n.log[0]!.gave).toBe("a".repeat(59) + "�");
  });
  it("a lone low surrogate is replaced too", () => {
    expect(normState({ log: [{ gave: "x\uDC00y", at: 1 }] }).log[0]!.gave).toBe("x�y");
  });
  it("NUL is stripped from every string field", () => {
    const n = normState({ log: [{ q: "a\u0000b", tag: "m\u0000", gave: "\u0000du", at: 1 }], last: "2026-10-24\u0000" });
    expect(n.log[0]).toMatchObject({ q: "ab", tag: "m", gave: "du" });
    expect(n.last).toBeNull();
    expect(JSON.stringify(n)).not.toContain("\\u0000");
  });
  it("a full emoji survives intact", () => {
    expect(normState({ log: [{ gave: "du 🥐", at: 1 }] }).log[0]!.gave).toBe("du 🥐");
  });
});

describe("prototype-named tags (C-shared-6)", () => {
  it("noteAnswer ignores tags that are not own keys of TAG and never touches Object.prototype", () => {
    const s = emptyState();
    for (const t of ["toString", "constructor", "__proto__", "hasOwnProperty", "nope"]) noteAnswer(s, t, true);
    expect(Object.keys(s.hist)).toEqual([]);
    expect(typeof Object.prototype.toString).toBe("function");
    expect((Object.prototype.toString as unknown as unknown[])[0]).toBeUndefined();
    expect(() => tagStats(s, {})).not.toThrow();
    noteAnswer(s, "m", false);
    expect(s.hist.m).toEqual([0, 1]);
  });
  it("weakTag and ruleSplit skip prototype names", () => {
    const s = emptyState();
    s.hist = JSON.parse('{"constructor":[0,9],"toString":[0,9]}') as typeof s.hist;
    expect(weakTag(s)).toBeNull();
    expect(ruleSplit(s)).toEqual({ strong: [], weak: [] });
  });
});
