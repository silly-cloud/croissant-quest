import { describe, expect, it } from "vitest";
import { BANK, PRON_DICT } from "@cq/content";
import { fullOf, pron } from "../src/index.js";

describe("pron", () => {
  it("[fixed #7] no liaison through an aspirate h", () => {
    expect(pron("Nous mangeons des haricots.").e).toBe("Noo mahn-ZHON day a-ree-KO");
  });
  it("links les/des to a following vowel", () => {
    expect(pron("Je mange des amis").e).toContain("-z");
  });
  it("links through a listed mute h (des huile) but not a verb ending", () => {
    expect(pron("des huile").e).toContain("-z");
    expect(pron("Vous mangez un pain").e).not.toContain("-z");
  });
  it("[fixed #20] never throws on prototype property names", () => {
    expect(() => pron("constructor")).not.toThrow();
    expect(pron("__proto__ toString").e).toBeTruthy();
  });
  it("returns three non-empty rows for every bank sentence", () => {
    for (const q of BANK) {
      const p = pron(fullOf(q));
      expect(p.e && p.g && p.h, q.a).toBeTruthy();
    }
  });
  it("dictionary has the Indic columns filled", () => {
    for (const [w, v] of Object.entries(PRON_DICT)) expect(v.every(Boolean), w).toBe(true);
  });
  it("[fixed #19] every bank sentence has no Latin letters in its Gujarati and Devanagari rows", () => {
    // 4 sentences (n'avons / n'achetons / n'y) fall back to the French word until the dictionary gets them
    for (const q of BANK) {
      const p = pron(fullOf(q));
      expect(/[A-Za-z]/.test(p.g + p.h), q.a).toBe(false);
    }
  });
});
