// Only in playwright.real.config.ts: the real NestJS API on Postgres (no coach key) behind the Next rewrite.
import { expect, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { answer, currentQuestion, playPerfectRound, qwrap, serverProgress, startTopic6, studyPace } from "../helpers";
import { API_ORIGIN, WEB_ORIGIN } from "./env";

interface Saved {
  xp: number;
  crowns: Record<string, number>;
  seen: Record<string, number>;
  wrong: Record<string, number>;
  hist: Record<string, [number, number]>;
  log: { q: string }[];
}

test.beforeEach(async ({ page }) => {
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

const local = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem("croissant-quest-v1") ?? "null") as Saved | null);
const banner = (page: Page) => page.getByRole("status").filter({ hasText: /Not synced/ });

test("a perfect round is saved on the server and comes back after the device copy is gone", async ({ page, request }) => {
  await studyPace(page);
  await page.goto("/");
  await startTopic6(page);
  await playPerfectRound(page);

  await expect.poll(async () => ((await serverProgress(page, request)).state as unknown as Saved).crowns?.["6"] ?? 0).toBeGreaterThan(0);
  const server = (await serverProgress(page, request)).state as unknown as Saved;
  expect(server.xp).toBeGreaterThan(0);
  expect(Object.keys(server.seen).length).toBeGreaterThanOrEqual(8);

  // forget this device's copy: everything on screen now has to come from Postgres
  await page.evaluate(() => localStorage.removeItem("croissant-quest-v1"));
  await page.reload();
  await expect(page.locator(".s-xp")).toContainText(String(server.xp));
  await expect.poll(async () => (await local(page))?.xp).toBe(server.xp);
  const back = (await local(page))!;
  expect(back.crowns["6"]).toBe(server.crowns["6"]);
  expect(back.seen).toEqual(server.seen);
  await expect(banner(page)).toBeHidden();
});

/**
 * Two browser contexts on one device id: B gets A's cookie, not its localStorage (a second tab would share both),
 * so each holds its own copy and base, like two devices of one player. Both have saved once when this returns.
 */
async function twoCopies(browser: Browser, request: APIRequestContext) {
  const ctxA = await browser.newContext({ baseURL: WEB_ORIGIN });
  const a = await ctxA.newPage();
  await a.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await studyPace(a);
  await a.goto("/");
  await expect.poll(async () => (await ctxA.cookies()).some((c) => c.name === "cq_device")).toBe(true);
  const ctxB = await browser.newContext({ baseURL: WEB_ORIGIN });
  await ctxB.addCookies(await ctxA.cookies());
  const b = await ctxB.newPage();
  await b.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await studyPace(b);
  const puts = { a: 0, b: 0 };
  a.on("request", (r) => void (r.method() === "PUT" && puts.a++));
  b.on("request", (r) => void (r.method() === "PUT" && puts.b++));
  await b.goto("/");
  await expect.poll(async () => (await serverProgress(b, request)).version).toBeGreaterThanOrEqual(2);
  const close = async () => {
    await ctxA.close();
    await ctxB.close();
  };
  return { a, b, puts, close };
}

test("two copies on one device both save: no 409 loop, nothing either of them did is lost", async ({ browser, request }) => {
  const { a, b, puts, close } = await twoCopies(browser, request);

  // both tabs now hold an older version than the server for at least one of their saves
  await startTopic6(a);
  await startTopic6(b);
  const qa = await currentQuestion(a);
  await answer(a, false); // A: a miss (wrong + log), no xp
  const qb = await currentQuestion(b);
  await answer(b, true); // B: xp, no miss

  await expect
    .poll(async () => {
      const s = (await serverProgress(a, request)).state as unknown as Saved;
      return {
        xp: s.xp,
        logA: s.log.some((e) => e.q === qa.id),
        seenA: (s.seen[qa.id] ?? 0) > 0,
        seenB: (s.seen[qb.id] ?? 0) > 0,
        missOnRuleA: s.hist[qa.tag]?.[1] ?? 0,
        rightOnRuleB: s.hist[qb.tag]?.[0] ?? 0,
      };
    })
    .toEqual({ xp: 10, logA: true, seenA: true, seenB: true, missOnRuleA: 1, rightOnRuleB: 1 });
  // AUD-01 (ADR 0010): B's later save is rebased onto the server copy, so A's miss stays queued in Weak Spots
  if (qa.id !== qb.id) await expect.poll(async () => ((await serverProgress(a, request)).state as unknown as Saved).wrong[qa.id] ?? 0).toBe(1);
  await expect(banner(a)).toBeHidden();
  await expect(banner(b)).toBeHidden();
  // a few retries converge; a 409 loop would hit MAX_PUT_TRIES (5) per change and show the banner
  expect(puts.a).toBeLessThanOrEqual(6);
  expect(puts.b).toBeLessThanOrEqual(6);
  await close();
});

test("two copies on one device both earn xp: the server total is the sum, not the larger one", async ({ browser, request }) => {
  const { a, b, close } = await twoCopies(browser, request);
  await startTopic6(a);
  await startTopic6(b);
  const xpOf = async () => ((await serverProgress(a, request)).state as unknown as Saved).xp;
  const before = await xpOf();
  // interleave: each answer is saved from a copy whose version the other has just moved on (409, rebase, retry)
  for (const p of [a, b, a, b]) {
    const q = await answer(p, true);
    await p.getByRole("button", { name: /Continue/ }).click();
    await expect(qwrap(p)).not.toHaveAttribute("data-qid", q.id);
  }
  // each copy: 10 for its first right answer, 13 for the second (combo 2, xpFor in @cq/shared); max-merge would give 23
  const sum = before + 2 * (10 + 13);
  await expect.poll(xpOf).toBe(sum);
  // both copies come to show the same total once they read the server again
  await a.reload();
  await b.reload();
  await expect.poll(async () => (await local(a))?.xp).toBe(sum);
  await expect.poll(async () => (await local(b))?.xp).toBe(sum);
  await expect(banner(a)).toBeHidden();
  await expect(banner(b)).toBeHidden();
  await close();
});

test("the coach with no key falls back to a local round", async ({ page }) => {
  await page.goto("/");
  await expect.poll(async () => (await page.context().cookies()).some((c) => c.name === "cq_device")).toBe(true);
  const coach = page.waitForResponse((r) => r.url().endsWith("/v1/coach/round"));
  await page.getByRole("button", { name: /Fresh questions from Claude/ }).click();
  const res = await coach;
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ fallback: true, reason: "no_key" });
  await expect(page).toHaveURL(/\/round\/6\?mode=weak/);
  await expect(qwrap(page)).toBeVisible();
  await expect(page.getByText(/Claude couldn't write them this time/)).toBeVisible();
});

test("the coach answering 401 no_device (cookie never set) also falls back to a local round", async ({ page }) => {
  // the progress read never reaches the API, so this browser has no device
  await page.route("**/v1/progress", (r) => r.abort("connectionrefused"));
  await page.goto("/");
  const coach = page.waitForResponse((r) => r.url().endsWith("/v1/coach/round"));
  await page.getByRole("button", { name: /Fresh questions from Claude/ }).click();
  const res = await coach;
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: "no_device" });
  await expect(page).toHaveURL(/\/round\/6\?mode=weak/);
  await expect(qwrap(page)).toBeVisible();
});

test("writes from another origin are refused, and the Next rewrite forwards the browser's Origin", async ({ page, browser, request }) => {
  await page.goto("/");
  await expect.poll(async () => (await serverProgress(page, request)).version).toBeGreaterThan(0);
  const body = { state: { xp: 999_999 } };
  const put = (url: string, origin: string, version: number) =>
    page.request.put(url, { headers: { origin, "content-type": "application/json", "if-match": String(version) }, data: body });
  const { version } = await serverProgress(page, request);

  // forged Origin, with this device's cookie: through the rewrite and straight at the API
  for (const url of [`${WEB_ORIGIN}/v1/progress`, `${API_ORIGIN}/v1/progress`]) {
    const res = await put(url, "http://evil.example", version);
    expect(res.status(), url).toBe(403);
    expect(await res.json()).toMatchObject({ error: "bad_origin" });
  }
  // the same request with the app's own Origin passes the rewrite: the API saw the browser's Origin, not none
  const ok = await put(`${WEB_ORIGIN}/v1/progress`, WEB_ORIGIN, version);
  expect(ok.status()).toBe(200);
  expect(((await ok.json()) as { state: { xp: number } }).state.xp).toBe(999_999);

  // a real page served from another origin (127.0.0.1 is not localhost): the browser sets Origin itself
  const ctx = await browser.newContext();
  const evil = await ctx.newPage();
  await evil.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await evil.goto(WEB_ORIGIN.replace("localhost", "127.0.0.1") + "/");
  const status = await evil.evaluate(async () => {
    const res = await fetch("/v1/progress", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": "0" },
      body: JSON.stringify({ state: {} }),
    });
    return { status: res.status, body: (await res.json()) as unknown };
  });
  expect(status).toEqual({ status: 403, body: expect.objectContaining({ error: "bad_origin" }) });
  // so its own saves fail and it says so
  await expect(banner(evil)).toBeVisible();
  await ctx.close();
});
