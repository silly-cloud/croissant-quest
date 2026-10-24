import { describe, expect, it } from "vitest";
import { BANK, TAG, TAGNAME, TOPICS, RULES, qid } from "../src/index.js";

describe("question bank", () => {
  it("has 246 questions with unique qids", () => {
    expect(BANK).toHaveLength(246);
    expect(new Set(BANK.map(qid)).size).toBe(246);
  });
  it("every tag used has rule text and a name", () => {
    for (const q of BANK) {
      expect(TAG[q.tag], q.tag).toBeDefined();
      expect(TAGNAME[q.tag], q.tag).toBeDefined();
    }
  });
  it("exception questions each carry their own rule text [fixed #15]", () => {
    const whys = BANK.filter((q) => q.why).length;
    expect(whys).toBe(14);
  });
  it("44 topics and rule cards for topics 1-6", () => {
    expect(TOPICS).toHaveLength(44);
    for (const t of [1, 2, 3, 4, 5, 6]) expect(RULES[t]).toBeTruthy();
  });
  it("keeps the corrected French rules", () => {
    const all = JSON.stringify([TAG, RULES]);
    expect(all).not.toMatch(/everything becomes de|collapses to DE/i);
    expect(all).not.toMatch(/CONSONANT before the final/);
  });
});
