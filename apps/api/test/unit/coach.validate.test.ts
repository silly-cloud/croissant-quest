import { describe, expect, it } from "vitest";
import { validateRound } from "../../src/modules/coach/coach.validate.js";

const row = (s: string, a: string, tag: string, o = ["du", "de la", "de l'", "des", "de", "d'"]) => ({ s, a, tag, o, en: "x" });
const keeps = (s: string, a: string, tag: string) => validateRound([row(s, a, tag)]).length === 1;

describe("coach validation: French elision and être (audit B-french-3)", () => {
  it("rejects a non-elided answer before a vowel or mute h", () => {
    expect(keeps("Je bois ___ eau fraîche.", "de la", "f")).toBe(false);
    expect(keeps("Il prend ___ huile d'olive.", "du", "m")).toBe(false);
  });
  it("rejects an elided answer before a consonant or an aspirate h", () => {
    expect(keeps("Tu prends ___ pain frais.", "de l'", "v")).toBe(false);
    expect(keeps("Il mange ___ homard grillé.", "de l'", "v")).toBe(false);
  });
  it("rejects de/d' after être + pas (the article stays)", () => {
    expect(keeps("Ce n'est pas ___ vin rouge.", "de", "neg")).toBe(false);
  });
  it("still accepts correct rows", () => {
    expect(keeps("Nous voulons ___ eau gazeuse.", "de l'", "v")).toBe(true);
    expect(keeps("Il commande ___ homard frais.", "du", "ah")).toBe(true);
    expect(keeps("Elle boit beaucoup ___ eau minérale.", "d'", "qty")).toBe(true);
    expect(keeps("Il ne boit pas ___ café noir.", "de", "neg")).toBe(true);
  });
  it("drops topic tags t1-t5 and cnt (not partitive choices)", () => {
    expect(keeps("Je mange ___ tarte maison.", "de la", "t4")).toBe(false);
    expect(keeps("Je mange ___ tarte maison.", "de la", "cnt")).toBe(false);
  });
});
