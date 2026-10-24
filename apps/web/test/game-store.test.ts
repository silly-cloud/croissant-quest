import { describe, expect, it } from "vitest";
import { BANK } from "@cq/content";
import { emptyState, normState } from "@cq/shared";
import { LS_KEY, GameStore } from "@/lib/game-store";
import { FakeApi } from "./fake-api";
import { makeStore, memStorage } from "./helpers";

const run = async (s: GameStore) => {
  void s.sync();
  await s.settled();
};
const saved = (patch: Record<string, unknown>) => JSON.stringify({ ...emptyState(), ...patch });

describe("local progress", () => {
  it("starts empty with the mastered stops crowned", () => {
    const { store } = makeStore();
    expect(store.state.xp).toBe(0);
    expect(store.state.crowns[1]).toBe(5);
  });

  it("loads the single-file game's save from localStorage and writes back under the same key", () => {
    const { store, storage } = makeStore(undefined, { [LS_KEY]: saved({ xp: 120, streak: 3, ts: 5 }) });
    expect(store.state.xp).toBe(120);
    store.update((d) => void (d.xp += 10));
    expect(JSON.parse(storage.raw.get(LS_KEY)!).xp).toBe(130);
  });

  it("survives a corrupt save", () => {
    const { store } = makeStore(undefined, { [LS_KEY]: "{not json" });
    expect(store.state.xp).toBe(0);
  });

  it("drops history keys for rules that do not exist (they reach the UI)", () => {
    const { store } = makeStore(undefined, { [LS_KEY]: saved({ hist: { "<img onerror=x>": [1, 1], m: [2, 0] } }) });
    expect(Object.keys(store.state.hist)).toEqual(["m"]);
  });

  it("works with no storage at all", () => {
    const store = new GameStore({ storage: null, fetch: () => Promise.reject(new Error("x")) });
    store.update((d) => void (d.xp = 5));
    expect(store.state.xp).toBe(5);
  });
});

describe("offline fallback", () => {
  it("keeps playing and saving locally when the API is down, and says so", async () => {
    const api = new FakeApi();
    api.down = true;
    const { store, storage } = makeStore(api);
    store.update((d) => void (d.xp = 40));
    await run(store);
    expect(store.getSnapshot().sync).toBe("error");
    expect(JSON.parse(storage.raw.get(LS_KEY)!).xp).toBe(40);
    expect(store.bank).toBe(BANK);
  });

  it("recovers on the next sync when the API comes back", async () => {
    const api = new FakeApi();
    api.down = true;
    const { store } = makeStore(api);
    store.update((d) => void (d.xp = 40));
    await run(store);
    expect(store.getSnapshot().sync).toBe("error");
    api.down = false;
    await run(store);
    expect(store.getSnapshot().sync).toBe("ok");
    expect((api.state as { xp: number }).xp).toBe(40);
  });

  it("uses the server's question bank when it answers, the bundled one when it does not", async () => {
    const api = new FakeApi();
    const { store } = makeStore(api);
    await store.loadBank();
    expect(store.usingServerBank).toBe(true);
    expect(store.bank).toHaveLength(BANK.length);
    api.down = true;
    const off = makeStore(api).store;
    await off.loadBank();
    expect(off.usingServerBank).toBe(false);
    expect(off.bank).toBe(BANK);
  });
});

describe("sync with the API", () => {
  it("merges the server copy into the local one (counters take the larger value)", async () => {
    const api = new FakeApi();
    api.state = { ...emptyState(), xp: 500, cro: 2, rounds: 7, ts: 10 };
    api.version = 3;
    const { store } = makeStore(api, { [LS_KEY]: saved({ xp: 100, cro: 5, ts: 20 }) });
    await run(store);
    expect(store.state.xp).toBe(500);
    expect(store.state.cro).toBe(5);
    expect(store.state.rounds).toBe(7);
    expect(store.getSnapshot().sync).toBe("ok");
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect(put.ifMatch).toBe("3");
  });

  it("on 409 merges the server's newer copy and sends again", async () => {
    const api = new FakeApi();
    const { store } = makeStore(api);
    await run(store); // learns version 0
    // another tab saves first
    api.beforePut = () => api.external({ ...emptyState(), xp: 300, cro: 4, crowns: { 6: 2 }, ts: 1 });
    store.update((d) => void ((d.xp = 100), (d.crowns[6] = 1)));
    await run(store);
    const puts = api.calls.filter((c) => c.method === "PUT");
    expect(puts.length).toBeGreaterThanOrEqual(2);
    expect(puts.at(-1)!.ifMatch).not.toBe(puts[0]!.ifMatch);
    // nothing went down: larger counters from both sides survive
    expect(store.state.xp).toBe(300);
    expect(store.state.cro).toBe(4);
    expect(store.state.crowns[6]).toBe(2);
    const final = normState(api.state);
    expect(final.xp).toBe(300);
    expect(final.cro).toBe(4);
    expect(store.getSnapshot().sync).toBe("ok");
  });

  it("gives up with the banner after repeated conflicts, keeping local progress", async () => {
    const api = new FakeApi();
    const real = api.fetch;
    let n = 0;
    // every PUT finds the server moved again
    const stubborn: typeof fetch = (input, init) => {
      if (init?.method === "PUT") api.external({ ...emptyState(), xp: ++n, ts: n });
      return real(input, init);
    };
    const store = new GameStore({ fetch: stubborn, storage: memStorage() });
    store.update((d) => void (d.xp = 9));
    await run(store);
    expect(store.getSnapshot().sync).toBe("error");
    expect(store.state.xp).toBeGreaterThanOrEqual(9); // counters never go down
  });

  it("never PUTs before a GET (the GET creates the device); a 401 is treated like offline and retried after a GET", async () => {
    const api = new FakeApi();
    const { store } = makeStore(api);
    await run(store);
    expect(api.calls[0]!.method).toBe("GET");
    api.cookie = false; // server forgot the device
    store.update((d) => void (d.xp = 3));
    await store.settled();
    expect(store.getSnapshot().sync).toBe("error");
    expect(store.state.xp).toBe(3);
    await run(store);
    expect(store.getSnapshot().sync).toBe("ok");
    expect((api.state as { xp: number }).xp).toBe(3);
  });

  it("sends the log trimmed, like the single-file game", async () => {
    const api = new FakeApi();
    const { store } = makeStore(api);
    store.update((d) => {
      d.log = Array.from({ length: 300 }, (_, i) => ({ q: "q" + i, t: 6, tag: "m", gave: "x", at: i }));
    });
    await run(store);
    const put = api.calls.find((c) => c.method === "PUT")!;
    expect((put.body as { state: { log: unknown[] } }).state.log).toHaveLength(120);
  });

  it("serialises: a save made during a sync runs afterwards, once", async () => {
    const api = new FakeApi();
    const { store } = makeStore(api);
    const first = store.sync();
    store.update((d) => void (d.xp = 1));
    store.update((d) => void (d.xp = 2));
    await first;
    await run(store);
    expect((api.state as { xp: number }).xp).toBe(2);
  });
});

describe("storage helpers", () => {
  it("memStorage reads back what it was given", () => {
    expect(memStorage({ a: "1" }).getItem("a")).toBe("1");
  });
});
