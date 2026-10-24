import fs from "node:fs";
import path from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

export const FAKE = "http://127.0.0.1:3101";

interface BankQ {
  t: number;
  k: "choice" | "type" | "en2fr" | "build" | "fix" | "fr2en";
  s?: string;
  en?: string;
  a: string;
  o?: string[];
  bad?: string;
}
const raw = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "../../packages/content/data/bank.json"), "utf8")) as BankQ[];
export const qidOf = (q: BankQ) => q.t + "|" + q.k + "|" + (q.s || q.en || "") + "|" + q.a;
const byId = new Map(raw.map((q) => [qidOf(q), q]));

export async function fakeReset(request: import("@playwright/test").APIRequestContext) {
  await request.post(`${FAKE}/__fake/reset`);
}
export async function fakeSet(request: import("@playwright/test").APIRequestContext, patch: Record<string, unknown>) {
  await request.post(`${FAKE}/__fake/set`, { data: patch });
}
export async function fakeState(request: import("@playwright/test").APIRequestContext) {
  return (await (await request.get(`${FAKE}/__fake/state`)).json()) as {
    version: number;
    state: Record<string, unknown>;
    calls: { method: string; path: string; ifMatch: string | null }[];
  };
}

/** Study pace: no auto-advance timers, so a test reads the screen at its own speed. */
export async function studyPace(page: Page) {
  await page.addInitScript(() => localStorage.setItem("croissant-quest-v1-pace", "study"));
}

export const qwrap = (page: Page): Locator => page.locator("[data-qid]");

export async function currentQuestion(page: Page): Promise<BankQ & { id: string }> {
  const id = await qwrap(page).getAttribute("data-qid");
  const q = byId.get(id ?? "");
  if (!q) throw new Error("question not in the bank: " + id);
  return { ...q, id: id! };
}

/** Answer the question on screen. `right=false` gives a wrong answer. */
export async function answer(page: Page, right = true) {
  const q = await currentQuestion(page);
  switch (q.k) {
    case "choice":
    case "fr2en": {
      const pick = right ? q.a : q.o!.find((o) => o !== q.a)!;
      await page.getByRole("group", { name: "Answers" }).getByRole("button", { name: pick, exact: true }).click();
      return q;
    }
    case "type":
    case "en2fr":
      await page.getByRole("textbox").fill(right ? q.a : "zzz");
      await page.getByRole("button", { name: "Check" }).click();
      return q;
    case "build": {
      const words = q.a.replace(/[.!?]$/, "").split(" ");
      const use = right ? words : [words.at(-1)!];
      const bank = page.getByRole("group", { name: "Words to use" });
      for (const w of use) await bank.getByRole("button", { name: w, exact: true }).and(page.locator(":enabled")).first().click();
      await page.getByRole("button", { name: "Check" }).click();
      return q;
    }
    case "fix": {
      const bad = q.bad!.split(" ");
      const wrong = q.s!.split(" ").find((w) => !bad.includes(w))!;
      await page.getByRole("group", { name: /Tap the wrong word/ }).getByRole("button", { name: right ? bad[0]! : wrong, exact: true }).first().click();
      await page.getByRole("button", { name: "Check" }).click();
      return q;
    }
  }
}

/** Open stop 6 from the map and press Play. */
export async function startTopic6(page: Page) {
  await page.getByRole("button", { name: /^Partitive articles\. Stop 6/ }).click();
  await page.getByRole("link", { name: "Play a round" }).click();
  await expect(qwrap(page)).toBeVisible();
}

/** Play every question correctly in study pace (Continue after each) and land on the results. */
export async function playPerfectRound(page: Page) {
  const total = Number(await page.getByRole("progressbar").getAttribute("aria-valuemax"));
  for (let i = 0; i < total; i++) {
    const q = await answer(page, true);
    await page.getByRole("button", { name: /Continue/ }).click();
    if (i < total - 1) await expect(qwrap(page)).not.toHaveAttribute("data-qid", qidOf(q));
  }
  await page.waitForURL("**/results");
}
