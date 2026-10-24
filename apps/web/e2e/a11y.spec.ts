import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { answer, fakeReset, playPerfectRound, startTopic6, studyPace } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await fakeReset(request);
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await studyPace(page);
});

async function scan(page: Page, what: string) {
  // let entrance animations finish so colours are the final ones
  await page.waitForTimeout(450);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    bad.map((v) => `${what}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " :: " + (n.failureSummary ?? "").split("\n")[1]).join(" | ")}`),
  ).toEqual([]);
}

/** Visible, enabled controls must be at least 44x44 CSS px. */
async function tapTargets(page: Page, what: string) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    const sel = "button:not(:disabled), a[href], input:not([type=hidden]), summary, [role=button]";
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      const dlgOpen = document.querySelector("dialog[open]");
      if (dlgOpen && !dlgOpen.contains(el)) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || r.right < 0 || r.left < -100) continue;
      if (el.matches("input[type=radio]")) continue; // the visible pill is the label
      if (r.width < 43.5 || r.height < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  expect(small, what).toEqual([]);
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    });

    test("map, round, why-card and results have no serious or critical axe violations", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scan(page, `map/${scheme}`);
      await tapTargets(page, `map/${scheme}`);

      // the topic dialog
      await page.getByRole("button", { name: /^Partitive articles\. Stop 6/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `topic dialog/${scheme}`);
      await tapTargets(page, `topic dialog/${scheme}`);
      await page.keyboard.press("Escape");

      await startTopic6(page);
      await scan(page, `round/${scheme}`);
      await tapTargets(page, `round/${scheme}`);

      await answer(page, false);
      await expect(page.getByRole("dialog")).toBeVisible();
      await scan(page, `why-card/${scheme}`);
      await tapTargets(page, `why-card/${scheme}`);
      await page.getByRole("button", { name: "Got it" }).click();

      // right answer state (okstrip)
      await answer(page, true);
      await scan(page, `correct/${scheme}`);
      await tapTargets(page, `correct/${scheme}`);
      await page.getByRole("button", { name: /Continue/ }).click();

      await page.getByRole("button", { name: "Leave round" }).click();
      await startTopic6(page);
      await playPerfectRound(page);
      await scan(page, `results/${scheme}`);
      await tapTargets(page, `results/${scheme}`);
      for (const d of await page.locator("details.fold > summary").all()) await d.click();
      await page.getByRole("button", { name: "Lock it in" }).click();
      await expect(page.getByText("I say")).toBeVisible();
      await scan(page, `results expanded/${scheme}`);

      await page.goto("/settings");
      await scan(page, `settings/${scheme}`);
      await tapTargets(page, `settings/${scheme}`);
    });
  });
}

test("the manual dark toggle also passes axe on the map", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await page.getByRole("button", { name: "Switch light or dark theme" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await scan(page, "map/manual-dark");
});

test("every question kind passes axe (typed, built, fix, fr2en)", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  // crown 4 on stop 6 = tier-5 rounds, which mix typing, building and error spotting
  await page.addInitScript(() => localStorage.setItem("croissant-quest-v1", JSON.stringify({ crowns: { 6: 4 }, ts: 1 })));
  await page.goto("/");
  const seen = new Set<string>();
  for (let round = 0; round < 4 && seen.size < 3; round++) {
    await startTopic6(page);
    const total = Number(await page.getByRole("progressbar").getAttribute("aria-valuemax"));
    for (let i = 0; i < total; i++) {
      const kind = await page.locator("[data-qid]").getAttribute("data-kind");
      if (kind && !seen.has(kind) && kind !== "choice") {
        seen.add(kind);
        await scan(page, `kind ${kind}`);
        await tapTargets(page, `kind ${kind}`);
      }
      await answer(page, true);
      await page.getByRole("button", { name: /Continue/ }).click();
    }
    await page.waitForURL("**/results");
    await page.getByRole("link", { name: "Back to the map" }).click();
  }
  expect([...seen].length).toBeGreaterThanOrEqual(2);
});
