import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeApi } from "./fake-api";
import { makeHost, makeStore } from "./helpers";
import { BANK, qid } from "@cq/content";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(coach: FakeApi["coach"]) {
  const api = new FakeApi();
  api.coach = coach;
  const { store } = makeStore(api);
  const host = makeHost(store, { fetch: api.fetch as typeof fetch });
  return { api, store, host };
}

describe("Fresh questions / Drill", () => {
  it("coach unavailable (fallback) still starts a local weak round", async () => {
    const { host } = setup("fallback");
    const r = await host.fresh();
    expect(r).toBe("weak");
    expect(host.engine?.mode).toBe("weak");
    expect(host.engine?.getSnapshot().qs.length).toBeGreaterThan(0);
    expect(host.getSnapshot().busy).toBe(false);
  });

  it("a 429 from the coach falls back to a local round", async () => {
    const { host } = setup("limited");
    expect(await host.fresh()).toBe("weak");
  });

  it("coach error and an unreachable API also fall back", async () => {
    const a = setup("error");
    expect(await a.host.fresh()).toBe("weak");
    const b = setup("fallback");
    b.api.down = true;
    expect(await b.host.fresh()).toBe("weak");
  });

  it("coach questions start an 'ai' round and are marked _ai", async () => {
    const { host } = setup("questions");
    expect(await host.fresh()).toBe("ai");
    expect(host.engine?.mode).toBe("ai");
    expect(host.engine?.getSnapshot().qs.every((q) => q._ai)).toBe(true);
  });

  it("a double press does not start two requests", async () => {
    const { host, api } = setup("fallback");
    const [a, b] = await Promise.all([host.fresh(), host.fresh()]);
    expect([a, b].sort()).toEqual(["busy", "weak"]);
    expect(api.calls.filter((c) => c.path === "/v1/coach/round")).toHaveLength(1);
  });

  it("is disabled (busy) while waiting, and gives up after 30 s", async () => {
    const { host } = setup("hang");
    const p = host.fresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(host.getSnapshot().busy).toBe(true);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(host.getSnapshot().busy).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toBe("weak");
    expect(host.getSnapshot().busy).toBe(false);
  });

  it("ignores a late coach result if the round changed meanwhile", async () => {
    const { host, store } = setup("hang");
    const p = host.fresh();
    await vi.advanceTimersByTimeAsync(0);
    // the learner starts another round while Claude is still writing
    const local = host.startLocal(6, "weak")!;
    expect(local).toBeTruthy();
    expect(await p).toBe("stale");
    expect(host.engine).toBe(local);
    expect(host.engine?.mode).toBe("weak");
    expect(host.getSnapshot().busy).toBe(false);
    void store;
  });

  it("Quit while waiting cancels the request and starts nothing", async () => {
    const { host } = setup("hang");
    const p = host.fresh();
    await vi.advanceTimersByTimeAsync(0);
    host.quit();
    expect(await p).toBe("stale");
    expect(host.engine).toBeNull();
    expect(host.getSnapshot().busy).toBe(false);
  });

  it("when every question is retired the drill still starts (repeats are the last resort, never a dead button)", async () => {
    const { host, store } = setup("fallback");
    store.update((d) => {
      for (const q of BANK) d.seen[qid(q)] = 3;
    });
    expect(await host.fresh()).toBe("weak");
    expect(host.engine?.getSnapshot().qs.length).toBeGreaterThan(0);
    expect(host.startLocal(6, "weak")).not.toBeNull();
  });
});

describe("page lifecycle", () => {
  it("release() cancels the round unless the page adopts it again (dev remount)", async () => {
    const { host } = setup("fallback");
    const e = host.startLocal(6, "normal")!;
    host.release();
    expect(host.adopt(6, "normal")).toBe(e); // remount in the same tick keeps the round
    await vi.advanceTimersByTimeAsync(5);
    expect(e.cancelled).toBe(false);
    host.release();
    await vi.advanceTimersByTimeAsync(5);
    expect(e.cancelled).toBe(true);
    expect(host.engine).toBeNull();
  });

  it("adopt() refuses a round for a different topic or mode", () => {
    const { host } = setup("fallback");
    host.startLocal(6, "normal");
    expect(host.adopt(6, "weak")).toBeNull();
    expect(host.adopt(2, "normal")).toBeNull();
  });
});
