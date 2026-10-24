// Audit 3 web fixes: AUD-03 (gave split by code points), AUD-21/E-web-2 (late coach result after leaving),
// AUD-30/A-product-3 (finish always reaches results), E-web-4 (sync backoff), AUD-20/A-product-1 (freshen repeats).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { BANK, qid, type Question } from "@cq/content";
import { emptyState, SEEN_CAP } from "@cq/shared";
import { requestExplain } from "@/lib/coach";
import { clipGave, FINISH_MS } from "@/lib/engine";
import { GameStore } from "@/lib/game-store";
import { GameProvider, type Game } from "@/lib/game-context";
import { Sfx } from "@/lib/fx";
import { RoundHost } from "@/lib/round-host";
import { SettingsStore } from "@/lib/settings";
import { FakeApi } from "./fake-api";
import { makeEngine, makeHost, makeStore, memStorage, rightPick } from "./helpers";

const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn(), refresh: vi.fn(), forward: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/round/6" }));
const { RoundScreen } = await import("@/components/RoundScreen");

const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe("AUD-03: what the learner typed is cut at 60 code points, never inside a character", () => {
  it("clipGave keeps an emoji at the boundary whole and repairs lone surrogates", () => {
    const typed = "a".repeat(59) + "😀" + "tail";
    expect(typed.slice(0, 60)).toMatch(lone); // the old cut
    const g = clipGave(typed);
    expect(Array.from(g)).toHaveLength(60);
    expect(g.endsWith("😀")).toBe(true);
    expect(g).not.toMatch(lone);
    expect(clipGave("x\uD83Dy\uDE00")).not.toMatch(lone);
    expect(clipGave(null)).toBe("");
  });

  it("the round record and the saved log hold the clipped, well-formed answer", () => {
    vi.useFakeTimers();
    const { store } = makeStore();
    const q = BANK.find((x) => x.k === "type" && x.t === 6)!;
    const e = makeEngine(store, [q], "normal", "study");
    e.answer("é".repeat(59) + "🥐🥐");
    const gave = e.getSnapshot().record[0]!.gave;
    expect(Array.from(gave)).toHaveLength(60);
    expect(gave).not.toMatch(lone);
    expect(store.state.log.at(-1)!.gave).toBe(gave);
  });

  it("the explain request sends the clipped answer too", async () => {
    let sent: { gave: string } | undefined;
    const f: typeof fetch = async (_u, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ fallback: true, reason: "no_key" }), { status: 200 });
    };
    await requestExplain(f, "q", "b".repeat(59) + "😀z");
    expect(sent!.gave).toBe("b".repeat(59) + "😀");
  });
});

describe("AUD-30: the results screen appears even if saving the score throws", () => {
  it("finish() still reaches phase done", () => {
    vi.useFakeTimers();
    const { store } = makeStore();
    const q = BANK.find((x) => x.k === "choice" && x.t === 6)!;
    const e = makeEngine(store, [q], "normal", "study");
    e.answer(rightPick(q));
    const spy = vi.spyOn(store, "update").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    e.next();
    vi.advanceTimersByTime(FINISH_MS);
    expect(e.getSnapshot().phase).toBe("done");
    expect(e.getSnapshot().outcome).toEqual({ crowned: false, perfect: false });
    expect(err).toHaveBeenCalled();
    spy.mockRestore();
    err.mockRestore();
  });
});

function gameWith(api: FakeApi): Game {
  const s = memStorage();
  const settings = new SettingsStore({ ...s, removeItem: (k: string) => void s.raw.delete(k) }, null);
  settings.setPace("study");
  const store = new GameStore({ storage: memStorage(), fetch: api.fetch });
  const host = new RoundHost(store, { getPace: () => settings.pace, fetch: api.fetch });
  return { store, host, settings, sfx: new Sfx(() => true) };
}

describe("AUD-21: a coach answer for a screen the learner has left never changes the screen", () => {
  beforeEach(() => {
    router.replace.mockClear();
    router.push.mockClear();
  });

  it("leaving the AI loading screen (not via X) drops the late result: no navigation, no round", async () => {
    const api = new FakeApi();
    let answer: (r: Response) => void = () => {};
    const real = api.fetch;
    api.fetch = (input, init) =>
      String(input).endsWith("/coach/round") ? new Promise<Response>((r) => (answer = r)) : real(input, init);
    const game = gameWith(api);
    const view = render(
      <GameProvider game={game}>
        <RoundScreen topic={6} mode="ai" />
      </GameProvider>,
    );
    expect(await screen.findByText(/Claude is writing 8 questions/)).toBeInTheDocument();
    await waitFor(() => expect(game.host.getSnapshot().busy).toBe(true));
    view.unmount(); // e.g. the HUD's Settings link
    await act(async () => {
      answer(new Response(JSON.stringify({ fallback: true, reason: "no_key" }), { status: 200 }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
    expect(game.host.engine).toBeNull();
    expect(game.host.getSnapshot().busy).toBe(false);
  });
});

describe("E-web-4: a failing sync backs off instead of re-reading on every answer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const gets = (api: FakeApi) => api.calls.filter((c) => c.method === "GET" && c.path === "/v1/progress").length;

  it("cookie never sticks (GET 200, PUT 401): five answers make one GET, then one retry timer", async () => {
    const api = new FakeApi();
    const real = api.fetch;
    api.fetch = async (input, init) => {
      const r = await real(input, init);
      api.cookie = false; // the browser dropped the cookie again
      return r;
    };
    const { store } = makeStore(api);
    await store.sync();
    expect(store.getSnapshot().sync).toBe("error");
    expect(gets(api)).toBe(1);
    for (let i = 0; i < 5; i++) store.update((d) => void (d.xp += 1));
    await store.settled();
    expect(gets(api)).toBe(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(gets(api)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await store.settled();
    expect(gets(api)).toBe(2);
    // the next wait is longer
    await vi.advanceTimersByTimeAsync(3_999);
    expect(gets(api)).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    await store.settled();
    expect(gets(api)).toBe(3);
  });

  it.each([429, 401])("GET /v1/progress answering %i waits (Retry-After honoured) and then recovers", async (status) => {
    const api = new FakeApi();
    const real = api.fetch;
    let refuse = true;
    api.fetch = async (input, init) => {
      if (refuse && String(input).endsWith("/progress") && (init?.method ?? "GET") === "GET") {
        api.calls.push({ method: "GET", path: "/v1/progress" });
        return new Response(JSON.stringify({ error: "x" }), { status, headers: { "retry-after": "30" } });
      }
      return real(input, init);
    };
    const { store } = makeStore(api);
    await store.sync();
    expect(store.getSnapshot().sync).toBe("error");
    store.update((d) => void (d.xp = 7));
    store.update((d) => void (d.xp = 8));
    await store.settled();
    expect(gets(api)).toBe(1);
    refuse = false;
    const wait = status === 429 ? 30_000 : 2_000;
    await vi.advanceTimersByTimeAsync(wait - 1);
    expect(gets(api)).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await store.settled();
    expect(store.getSnapshot().sync).toBe("ok");
    expect((api.state as { xp: number }).xp).toBe(8);
  });

  it("an explicit retry (the browser came back online) does not wait for the timer", async () => {
    const api = new FakeApi();
    api.down = true;
    const { store } = makeStore(api);
    await store.sync();
    api.down = false;
    store.resume();
    await store.settled();
    expect(store.getSnapshot().sync).toBe("ok");
  });
});

describe("AUD-20: retired repeats in a topic-6 round", () => {
  const retireAll = (store: GameStore) =>
    store.update((d) => {
      for (const q of BANK) d.seen[qid(q)] = SEEN_CAP;
    });

  it("asks the coach for that many replacements and swaps them in", async () => {
    const api = new FakeApi();
    api.coach = "questions";
    const { store } = makeStore(api);
    retireAll(store);
    const host = makeHost(store, { fetch: api.fetch as typeof fetch, rng: () => 0.5 });
    const e = await host.startRound(6, "normal");
    const call = api.calls.find((c) => c.path === "/v1/coach/round")!;
    const qs = e!.getSnapshot().qs;
    const stale = qs.filter((q: Question) => !q._ai);
    // every repeat was replaced (the fake writes 8)
    expect(stale).toHaveLength(0);
    expect((call.body as { n: number }).n).toBeGreaterThanOrEqual(4);
    expect(e!.repeats.size).toBe(0);
  });

  it("coach falls back: the repeats stay, each one labelled, with a note", async () => {
    const api = new FakeApi();
    api.coach = "fallback";
    const { store } = makeStore(api);
    retireAll(store);
    const host = makeHost(store, { fetch: api.fetch as typeof fetch, rng: () => 0.5 });
    const e = await host.startRound(6, "normal");
    const qs = e!.getSnapshot().qs;
    expect(qs.length).toBeGreaterThan(0);
    const repeats = qs.filter((q) => e!.isRepeat(q));
    expect(repeats.length).toBeGreaterThan(0);
    expect(repeats.every((q) => (store.state.seen[qid(q)] ?? 0) >= SEEN_CAP)).toBe(true);
    expect(host.getSnapshot().note).toMatch(/repeat/i);
  });

  it("a fresh learner's round has no repeats and never calls the coach", async () => {
    const api = new FakeApi();
    const { store } = makeStore(api);
    const host = makeHost(store, { fetch: api.fetch as typeof fetch });
    const e = await host.startRound(6, "normal");
    expect(e!.repeats.size).toBe(0);
    expect(api.calls.some((c) => c.path === "/v1/coach/round")).toBe(false);
  });

  it("the round screen labels a repeated question visibly", async () => {
    const api = new FakeApi();
    api.coach = "limited"; // 429 -> fallback, keep the repeats
    const game = gameWith(api);
    game.store.update((d) => {
      Object.assign(d, emptyState(), { ts: d.ts });
      for (const q of BANK) d.seen[qid(q)] = SEEN_CAP;
    });
    render(
      <GameProvider game={game}>
        <RoundScreen topic={6} mode="weak" />
      </GameProvider>,
    );
    expect(await screen.findByText(/Repeat/, { selector: ".repeat" })).toBeInTheDocument();
    expect(screen.getAllByText(/repeats/).length).toBeGreaterThan(0);
  });
});
