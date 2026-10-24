import { describe, expect, it } from "vitest";
import { BANK } from "@cq/content";
import { accentsOnly, fullOf, judge, knit, norm, qid } from "../src/index.js";

const find = (pred: (q: (typeof BANK)[number]) => boolean) => BANK.find(pred)!;

describe("norm / knit", () => {
  it("lowercases, straightens quotes, drops final punctuation, closes elision", () => {
    expect(norm("  Je  mange DE l’ eau!! ")).toBe("je mange de l'eau");
  });
  it("knit closes up an elided answer", () => expect(knit("l' homme")).toBe("l'homme"));
});

describe("qid is stable", () => {
  it("is topic|kind|sentence-or-english|answer", () => {
    expect(qid({ t: 6, k: "choice", s: "Je mange ___ pain.", a: "du" })).toBe("6|choice|Je mange ___ pain.|du");
    expect(qid({ t: 6, k: "en2fr", en: "I eat bread.", a: "Je mange du pain." })).toBe("6|en2fr|I eat bread.|Je mange du pain.");
  });
});

describe("fullOf", () => {
  it("choice fills the blank; type/en2fr/build return the answer; fr2en returns the sentence", () => {
    expect(fullOf(find((q) => q.k === "choice" && q.a === "de l'" && q.s!.endsWith("___ eau.")))).toMatch(/de l'eau\.$/);
    const t = find((q) => q.k === "type");
    expect(fullOf(t)).toBe(t.a);
    const f = find((q) => q.k === "fr2en");
    expect(fullOf(f)).toBe(f.s);
  });
  it("[fixed #6] a typed question's full sentence is not doubled", () => {
    const t = find((q) => q.k === "type" && q.a === "Je mange du fromage.");
    expect(fullOf(t)).toBe("Je mange du fromage.");
  });
});

describe("judge", () => {
  it("choice and fr2en need the exact option", () => {
    const c = find((q) => q.k === "choice");
    expect(judge(c, c.a)).toBe(true);
    expect(judge(c, c.a + "x")).toBe(false);
  });
  it("fix accepts any word of the wrong part", () => {
    const f = find((q) => q.k === "fix");
    expect(judge(f, f.bad!.split(" ")[0]!)).toBe(true);
    expect(judge(f, "zzz")).toBe(false);
  });
  it("type accepts the full sentence, ignoring case, quotes and final punctuation", () => {
    const t = find((q) => q.k === "type" && q.a === "Nous buvons de l'eau.");
    expect(judge(t, "nous buvons de l’eau")).toBe(true);
  });
  it("type also accepts just the missing word when it completes the sentence", () => {
    const t = find((q) => q.k === "type" && q.a === "Nous buvons de l'eau.");
    expect(judge(t, "de l'")).toBe(true);
    expect(judge(t, "du")).toBe(false);
  });
  it("[fixed #10] en2fr accepts the listed alternative subjects", () => {
    const withAlt = BANK.filter((q) => q.k === "en2fr" && q.alt?.length);
    expect(withAlt.length).toBeGreaterThanOrEqual(7);
    for (const q of withAlt) for (const a of q.alt!) expect(judge(q, a)).toBe(true);
  });
  it("every bank question is judged right for its own answer and wrong for nonsense", () => {
    for (const q of BANK) {
      const right = q.k === "fix" ? q.bad!.split(" ")[0]! : q.a;
      expect(judge(q, right), qid(q)).toBe(true);
      expect(judge(q, "zzzz-not-an-answer"), qid(q)).toBe(false);
    }
  });
  it("accentsOnly spots right words with wrong accents", () => {
    const b = find((q) => q.k === "en2fr" && /[éèêàç]/.test(q.a));
    const wrong = b.a.normalize("NFD").replace(/[̀-ͯ]/g, "");
    expect(accentsOnly(b, wrong, judge(b, wrong))).toBe(true);
  });
});
