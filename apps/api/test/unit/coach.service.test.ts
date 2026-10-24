import { describe, expect, it, vi } from "vitest";
import { BANK, qid } from "@cq/content";
import { normState } from "@cq/shared";
import { CoachService } from "../../src/modules/coach/coach.service.js";
import { coachConfig, type CoachConfig } from "../../src/modules/coach/coach.config.js";
import type { CoachClient } from "../../src/modules/coach/coach.client.js";

const fastCfg: CoachConfig = { ...coachConfig, timeoutMs: 200, retries: 2, backoffMs: 1 };
const progress = { get: async () => ({ state: normState({}), version: 0 }) };

const row = (s: string, a: string, o: string[], tag = "m") => ({ s, a, o, tag, en: "x", pe: "e", pg: "g", ph: "h" });
const GOOD = [
  row("Paul coupe ___ pain frais.", "du", ["du", "de la", "de l'", "des"], "m"),
  row("Elle boit ___ eau.", "de l'", ["du", "de la", "de l'", "des"], "v"),
  row("Nous prenons ___ salade.", "de la", ["du", "de la", "de l'", "des"], "f"),
  row("Tu achetes ___ pommes.", "des", ["du", "de la", "de l'", "des"], "p"),
  row("Je ne bois pas ___ cafe zzz.", "de", ["du", "de", "de la", "des"], "neg"),
];
const reply = (rows: unknown) => async () => JSON.stringify(rows);
const mk = (complete: CoachClient["complete"] | null, cfg = fastCfg) =>
  new CoachService(complete ? { complete } : null, cfg, progress as never);

describe("coach.round", () => {
  it("returns validated questions marked _ai, t6 tier3, with pron filled", async () => {
    const r = await mk(reply(GOOD)).round("u", { n: 8, focus: [] });
    expect(r.fallback).toBe(false);
    if (r.fallback) return;
    expect(r.questions).toHaveLength(5);
    for (const q of r.questions) {
      expect(q).toMatchObject({ _ai: true, t: 6, tier: 3, k: "choice" });
      expect(q.s).toContain("___");
      expect(q.o).toContain(q.a);
      expect(q.pr?.e).toBeTruthy();
    }
  });

  it("computes pron via the shared pron() when the model leaves it blank", async () => {
    const rows = GOOD.map((r) => ({ ...r, pe: "", pg: "", ph: "" }));
    const r = await mk(reply(rows)).round("u", { n: 8, focus: [] });
    if (r.fallback) throw new Error("fallback");
    expect(r.questions[0]!.pr!.e.length).toBeGreaterThan(0);
    expect(r.questions[0]!.pr!.g.length).toBeGreaterThan(0);
  });

  it("no key: fallback no_key and no client call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const r = await mk(null).round("u", { n: 8, focus: [] });
    expect(r).toEqual({ fallback: true, reason: "no_key" });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("times out -> reason timeout", async () => {
    const hang: CoachClient["complete"] = (_req, { signal }) =>
      new Promise((_res, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    const r = await mk(hang, { ...fastCfg, timeoutMs: 30 }).round("u", { n: 8, focus: [] });
    expect(r).toEqual({ fallback: true, reason: "timeout" });
  });

  it("retries with backoff then succeeds", async () => {
    const complete = vi
      .fn<CoachClient["complete"]>()
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 529 }))
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { status: 500 }))
      .mockImplementationOnce(reply(GOOD));
    const r = await mk(complete).round("u", { n: 8, focus: [] });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(r.fallback).toBe(false);
  });

  it("gives up after retries -> reason error", async () => {
    const complete = vi.fn<CoachClient["complete"]>().mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    const r = await mk(complete).round("u", { n: 8, focus: [] });
    expect(complete).toHaveBeenCalledTimes(3);
    expect(r).toEqual({ fallback: true, reason: "error" });
  });

  it("does not retry a 4xx (bad key) other than 429", async () => {
    const complete = vi.fn<CoachClient["complete"]>().mockRejectedValue(Object.assign(new Error("x"), { status: 401 }));
    const r = await mk(complete).round("u", { n: 8, focus: [] });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ fallback: true, reason: "error" });
  });

  it("invalid JSON -> invalid", async () => {
    const r = await mk(async () => "sorry, here are some questions!").round("u", { n: 8, focus: [] });
    expect(r).toEqual({ fallback: true, reason: "invalid" });
  });

  it("accepts JSON wrapped in a code fence", async () => {
    const r = await mk(async () => "```json\n" + JSON.stringify(GOOD) + "\n```").round("u", { n: 8, focus: [] });
    expect(r.fallback).toBe(false);
  });

  it("rejects a copy of a bank question (qid and normalised sentence)", async () => {
    const b = BANK.find((q) => q.k === "choice" && q.s && q.o)!;
    const exact = { s: b.s, a: b.a, o: b.o, tag: b.tag, en: "x" };
    const spaced = { ...exact, s: b.s!.toUpperCase().replace(/ /g, "  ") + " " };
    const r = await mk(reply([exact, spaced, ...GOOD.slice(0, 3)])).round("u", { n: 8, focus: [] });
    // only 3 left of 5 -> below 4 -> invalid, and neither copy survived
    expect(r).toEqual({ fallback: true, reason: "invalid" });
    expect(qid({ ...b, t: 6 })).toBeTruthy();
  });

  it("keeps good ones when copies are dropped and 4+ remain", async () => {
    const b = BANK.find((q) => q.k === "choice" && q.s && q.o)!;
    const r = await mk(reply([{ s: b.s, a: b.a, o: b.o, tag: b.tag }, ...GOOD])).round("u", { n: 8, focus: [] });
    if (r.fallback) throw new Error("fallback");
    expect(r.questions.map((q) => q.s)).not.toContain(b.s);
    expect(r.questions).toHaveLength(5);
  });

  it("rejects an unknown tag (never defaults to m)", async () => {
    const r = await mk(reply([...GOOD.slice(0, 3), row("Il boit ___ lait.", "du", ["du", "de la"], "zzz")])).round("u", {
      n: 8,
      focus: [],
    });
    expect(r).toEqual({ fallback: true, reason: "invalid" });
  });

  it("drops: no blank, answer not in options, duplicates, markup", async () => {
    const bad = [
      row("Il mange du chocolat.", "du", ["du", "de la"]),
      row("Il mange ___ pain.", "du", ["de la", "des"]),
      row("Elle boit ___ eau.", "de l'", ["du", "de la", "de l'", "des"], "v"),
      row("Elle boit ___ eau.", "de l'", ["du", "de la", "de l'", "des"], "v"),
      row("Il lit <b>___</b> livre.", "un", ["un", "une"], "m"),
    ];
    const r = await mk(reply([...GOOD, ...bad])).round("u", { n: 8, focus: [] });
    if (r.fallback) throw new Error("fallback " + r.reason);
    expect(r.questions).toHaveLength(5); // only the 5 good ones; all 5 bad rows dropped
  });

  it("never leaks the key via the prompt", async () => {
    const seen: string[] = [];
    await mk(async (req) => (seen.push(req.prompt), JSON.stringify(GOOD))).round("u", { n: 8, focus: ["neg"] });
    expect(seen[0]).toContain("neg");
    expect(seen[0]).toContain("Write 8");
  });
});

describe("coach.explain", () => {
  const q = BANK.find((x) => x.k === "type")!;
  it("returns short text and truncates the learner answer to 60 chars", async () => {
    const prompts: string[] = [];
    const svc = mk(async (req) => (prompts.push(req.prompt), "You wrote X.\nRemember Y."));
    const r = await svc.explain({ qid: qid(q), gave: "z".repeat(300) });
    expect(r).toEqual({ fallback: false, text: "You wrote X.\nRemember Y." });
    expect(prompts[0]).toContain("z".repeat(60));
    expect(prompts[0]).not.toContain("z".repeat(61));
  });
  it("no key, unknown qid, empty answer, timeout", async () => {
    expect(await mk(null).explain({ qid: qid(q), gave: "a" })).toEqual({ fallback: true, reason: "no_key" });
    expect(await mk(async () => "x").explain({ qid: "nope", gave: "a" })).toEqual({ fallback: true, reason: "invalid" });
    expect(await mk(async () => "   ").explain({ qid: qid(q), gave: "a" })).toEqual({ fallback: true, reason: "invalid" });
    const hang: CoachClient["complete"] = (_r, { signal }) =>
      new Promise((_s, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
    expect(await mk(hang, { ...fastCfg, timeoutMs: 20 }).explain({ qid: qid(q), gave: "a" })).toEqual({
      fallback: true,
      reason: "timeout",
    });
  });
});
