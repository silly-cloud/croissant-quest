import { expect, test } from "@playwright/test";
import { answer, currentQuestion, fakeReset, fakeSet, fakeState, playPerfectRound, qidOf, qwrap, startTopic6, studyPace } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await fakeReset(request);
  // fonts come from Google at runtime; the sandbox has no route to them
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
});

test("the map loads with lang=en, the HUD and 44 stops", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1, name: "Croissant Quest" })).toBeVisible();
  await expect(page.locator(".path li")).toHaveCount(44);
  await expect(page.getByRole("button", { name: "Weak Spots Nothing to fix yet. Play a round first" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Fresh questions from Claude/ })).toBeEnabled();
  await expect(page.getByRole("button", { name: /^Aller\. Stop 14\. Locked/ })).toBeDisabled();
});

test("play a full round answering everything correctly, then see short results", async ({ page, request }) => {
  await studyPace(page);
  await page.goto("/");
  await startTopic6(page);
  // French is marked lang=fr
  await expect(page.locator("[data-qid] [lang='fr']").first()).toBeVisible();
  await playPerfectRound(page);

  await expect(page.getByRole("heading", { level: 2 })).toHaveText(/Crown earned!|Round complete/);
  await expect(page.locator(".sc").nth(1)).toContainText(/(\d+)\/\1/); // all correct
  // short page: score tiles and the buttons are above the fold, the long parts are collapsed
  const details = page.locator("details.fold");
  await expect(details).toHaveCount(2); // feel + say list (report appears after the feel is locked)
  for (const d of await details.all()) await expect(d).not.toHaveAttribute("open", "");
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  expect(height).toBeLessThan(1100);
  await expect(page.getByRole("link", { name: "Back to the map" })).toBeInViewport();
  await expect(page.getByRole("button", { name: /Drill my weak spots/ })).toBeInViewport();

  // progress reached the API with an If-Match
  await expect.poll(async () => (await fakeState(request)).version).toBeGreaterThan(0);
  const st = await fakeState(request);
  expect((st.state as { xp: number }).xp).toBeGreaterThan(0);
  expect(st.calls.some((c) => c.method === "PUT" && c.ifMatch !== null)).toBe(true);

  // the say-list shows three readings per sentence
  await page.getByText("Say it out loud").click();
  const first = page.locator(".sayrow").first();
  await expect(first.locator("dd")).toHaveCount(3);
  await expect(first.locator("dd[lang='gu']")).not.toBeEmpty();
  await expect(first.locator("dd[lang='hi']")).not.toBeEmpty();

  // feel meter: drill is guided until the number is locked, then the report appears
  await page.getByRole("button", { name: /Drill my weak spots/ }).click();
  await expect(page.getByRole("slider")).toBeFocused();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page.getByText("I say")).toBeVisible();
  await expect(page.getByText("What that round says about you", { exact: true }).first()).toBeAttached();
  await expect(page.locator("details.fold")).toHaveCount(3);

  await page.getByRole("link", { name: "Back to the map" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator(".s-xp")).not.toContainText(/^0/);
});

test("a correct answer announces itself, shows three readings, and fast pace moves on or holds", async ({ page }) => {
  await page.goto("/");
  await startTopic6(page);
  const first = await currentQuestion(page);
  await answer(page, true);
  await expect(page.getByRole("status").filter({ hasText: /Correct!/ })).toBeAttached();
  await expect(page.locator(".okstrip dd")).toHaveCount(3);
  // focus moved to the next control, not left on a dead button
  await expect(page.getByRole("button", { name: /keep it on screen/ })).toBeFocused();
  // tapping the card holds it: nothing moves for longer than the 3.4 s countdown
  await page.locator(".okstrip .say").click();
  await expect(page.getByRole("button", { name: /Continue/ })).toBeFocused();
  await page.waitForTimeout(3800);
  await expect(qwrap(page)).toHaveAttribute("data-qid", qidOf(first));
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(qwrap(page)).not.toHaveAttribute("data-qid", qidOf(first));

  // next one: left alone, it advances by itself
  const second = await currentQuestion(page);
  await answer(page, true);
  await expect(qwrap(page)).not.toHaveAttribute("data-qid", qidOf(second), { timeout: 6000 });
});

test("a wrong answer opens the why-card dialog: focus inside, Escape moves on", async ({ page }) => {
  await studyPace(page);
  await page.goto("/");
  await startTopic6(page);
  const q = await answer(page, false);
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("button", { name: "Got it" })).toBeFocused();
  await expect(dlg.locator("dd")).toHaveCount(3);
  await expect(page.getByRole("status").filter({ hasText: /Not quite/ })).toBeAttached();
  await expect(page.getByRole("img", { name: "4 of 5 hearts left" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(qwrap(page)).not.toHaveAttribute("data-qid", qidOf(q));
});

test("Quit mid-round, start another: question 1 is shown and stale timers do nothing", async ({ page }) => {
  await page.goto("/"); // fast pace: answering starts the 3.4 s auto-advance
  await startTopic6(page);
  await answer(page, true);
  await page.getByRole("button", { name: "Leave round" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await startTopic6(page);
  const bar = page.getByRole("progressbar");
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("status").filter({ hasText: /^Question 1 of/ })).toBeAttached();
  const id = await qwrap(page).getAttribute("data-qid");
  await page.waitForTimeout(4500); // longer than the old round's countdown
  await expect(bar).toHaveAttribute("aria-valuenow", "0");
  await expect(qwrap(page)).toHaveAttribute("data-qid", id!);
});

test("topic dialog: focus moves in and is trapped, Escape closes and focus returns", async ({ page }) => {
  await page.goto("/");
  const stop = page.getByRole("button", { name: /^Partitive articles\. Stop 6/ });
  await stop.focus();
  await stop.press("Enter");
  const dlg = page.getByRole("dialog", { name: "Partitive articles" });
  await expect(dlg).toBeVisible();
  await expect(dlg.locator("h5").first()).toBeVisible(); // the rule card rendered through the allow-list
  await expect(dlg.locator("script")).toHaveCount(0);
  const inside = () => page.evaluate(() => !!document.activeElement?.closest("dialog"));
  expect(await inside()).toBe(true);
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    expect(await inside()).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(stop).toBeFocused();
});

test("coach unavailable: Fresh questions and Weak Spots still start a round", async ({ page, request }) => {
  await fakeSet(request, { coach: "fallback" });
  await page.goto("/");
  await page.getByRole("button", { name: /Fresh questions from Claude/ }).click();
  await expect(page).toHaveURL(/\/round\/6\?mode=weak/);
  await expect(qwrap(page)).toBeVisible();
  await page.getByRole("button", { name: "Leave round" }).click();

  await page.getByRole("button", { name: /^Weak Spots/ }).click();
  await expect(page).toHaveURL(/\/round\/6\?mode=weak/);
  await expect(qwrap(page)).toBeVisible();
});

test("coach questions start an AI round", async ({ page, request }) => {
  await fakeSet(request, { coach: "questions" });
  await page.goto("/");
  await page.getByRole("button", { name: /Fresh questions from Claude/ }).click();
  await expect(page).toHaveURL(/\/round\/6\?mode=ai/);
  await expect(qwrap(page)).toBeVisible();
});

test("the API down: a banner says so, the round still plays, progress stays on the device", async ({ page, request }) => {
  await fakeSet(request, { down: true });
  await studyPace(page);
  await page.goto("/");
  const banner = page.getByRole("status").filter({ hasText: /Not synced/ });
  await expect(banner).toBeVisible();
  await startTopic6(page);
  await answer(page, true);
  await expect(page.getByRole("button", { name: /Continue/ })).toBeVisible();
  await page.reload();
  await expect(page.locator(".s-xp")).toContainText("10");
  await expect(banner).toBeVisible();
  // the API comes back: the next save syncs and the banner clears
  await fakeSet(request, { down: false });
  await page.evaluate(() => dispatchEvent(new Event("online")));
  await expect(banner).toBeHidden();
  await expect.poll(async () => ((await fakeState(request)).state as { xp?: number }).xp).toBe(10);
});

test("settings: pace, sound and theme persist", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("radio", { name: "📖 Study" }).check();
  await page.getByRole("radio", { name: "🔇 Off" }).check();
  await page.getByRole("radio", { name: "Dark" }).check();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.getByRole("radio", { name: "📖 Study" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "🔇 Off" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
