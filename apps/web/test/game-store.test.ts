import { describe, expect, it } from "vitest";
import { BANK, qid } from "@cq/content";
import { emptyState, normState } from "@cq/shared";
import { BASE_KEY, LS_KEY, GameStore, type SyncLock } from "@/lib/game-store";
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
  it("adds a save made before this client kept a base (no cq.base) onto the server copy, once", async () => {
    const api = new FakeApi();
    api.state = { ...emptyState(), xp: 500, cro: 2, rounds: 7, ts: 10 };
    api.version = 3;
    const { store } = makeStore(api, { [LS_KEY]: saved({ xp: 100, cro: 5, ts: 20 }) });
    await run(store);
    // base = an empty state: the whole local save is new progress, counted exactly once
    expect(store.state.xp).toBe(600);
    expect(store.state.cro).toBe(7);
    expect(store.state.rounds).toBe(7);
    await run(store);
    expect(normState(api.state).xp).toBe(600);
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
    // the other tab's copy plus this tab's own increments (AUD-01: summed, not maxed)
    expect(store.state.xp).toBe(400);
    expect(store.state.cro).toBe(4);
    expect(store.state.crowns[6]).toBe(2);
    const final = normState(api.state);
    expect(final.xp).toBe(400);
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

/** Web Locks stand-in shared by the tabs of one device: one sync at a time. */
const deviceLock = (): SyncLock => {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const r = tail.then(fn);
    tail = r.catch(() => undefined);
    return r;
  };
};
/** A tab (or device) on `storage`, with its own network switch and a count of the 409s it got. */
const tab = (api: FakeApi, storage = memStorage(), lock?: SyncLock) => {
  const net = { offline: false, conflicts: 0 };
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (net.offline) throw new TypeError("offline");
    const res = await api.fetch(input, init);
    if (res.status === 409) net.conflicts++;
    return res;
  };
  return { store: new GameStore({ fetch, storage, lock }), storage, net };
};
const [q1, q2] = BANK.filter((q) => q.t === 6).map(qid) as [string, string];
const server = (api: FakeApi) => normState(api.state);
const miss = (q: string, at: number) => ({ q, t: 6, tag: "m", gave: "x", at });

describe("AUD-01: rebase on sync (ADR 0010)", () => {
  it("two tabs, interleaved saves with 409s: the totals are the sum of every increment", async () => {
    const api = new FakeApi();
    const A = tab(api);
    const B = tab(api);
    await run(A.store);
    await run(B.store);
    for (let i = 0; i < 5; i++) {
      A.store.update((d) => void ((d.xp += 10), (d.rounds += 1), (d.hist.m = [(d.hist.m?.[0] ?? 0) + 1, d.hist.m?.[1] ?? 0])));
      B.store.update((d) => void ((d.xp += 7), (d.seen[q1] = (d.seen[q1] ?? 0) + 1), (d.cro += 1)));
      await Promise.all([A.store.settled(), B.store.settled()]);
    }
    await run(A.store);
    await run(B.store);
    await run(A.store);
    expect(A.net.conflicts + B.net.conflicts).toBeGreaterThan(0);
    const s = server(api);
    expect([s.xp, s.rounds, s.cro, s.seen[q1], s.hist.m]).toEqual([85, 5, 5, 5, [5, 0]]);
    expect(A.store.state.xp).toBe(85);
    expect(B.store.state.xp).toBe(85);
    expect(A.store.getSnapshot().sync).toBe("ok");
  });

  it("a miss made in tab A survives tab B's later save", async () => {
    const api = new FakeApi();
    const A = tab(api);
    const B = tab(api);
    await run(A.store);
    await run(B.store);
    A.store.update((d) => void ((d.wrong[q1] = 1), (d.hist.m = [0, 1]), d.log.push(miss(q1, 1))));
    await A.store.settled();
    B.store.update((d) => void ((d.xp += 10), (d.seen[q2] = 1)));
    await B.store.settled();
    expect(B.net.conflicts).toBe(1);
    const s = server(api);
    expect(s.wrong[q1]).toBe(1);
    expect(s.log.map((e) => e.q)).toEqual([q1]);
    expect([s.xp, s.seen[q2], s.hist.m]).toEqual([10, 1, [0, 1]]);
    expect(B.store.state.wrong[q1]).toBe(1);
  });

  it("a miss cleared in B is not resurrected by A, unless A missed it again after", async () => {
    const api = new FakeApi();
    const A = tab(api);
    const B = tab(api);
    A.store.update((d) => void ((d.wrong[q1] = 2), (d.wrong[q2] = 2)));
    await A.store.settled();
    await run(B.store);
    expect(B.store.state.wrong).toEqual({ [q1]: 2, [q2]: 2 });
    B.store.update((d) => void (delete d.wrong[q1], delete d.wrong[q2]));
    await B.store.settled();
    // A is stale and still shows both misses: it plays elsewhere, and misses q2 once more
    A.store.update((d) => void ((d.xp += 10), (d.wrong[q2] = (d.wrong[q2] ?? 0) + 1)));
    await A.store.settled();
    expect(A.net.conflicts).toBe(1);
    const s = server(api);
    expect(s.wrong[q1]).toBeUndefined();
    expect(s.wrong[q2]).toBe(3);
    expect(A.store.state.wrong).toEqual({ [q2]: 3 });
    expect(s.xp).toBe(10);
  });

  it("an offline device catches up with no loss", async () => {
    const api = new FakeApi();
    const A = tab(api);
    const D = tab(api);
    await run(A.store);
    await run(D.store);
    D.net.offline = true;
    for (let i = 0; i < 3; i++) D.store.update((d) => void ((d.xp += 10), (d.rounds += 1)));
    D.store.update((d) => void ((d.wrong[q2] = 1), d.log.push(miss(q2, 5))));
    await D.store.settled();
    expect(D.store.getSnapshot().sync).toBe("error");
    for (let i = 0; i < 4; i++) {
      A.store.update((d) => void ((d.xp += 5), (d.seen[q1] = (d.seen[q1] ?? 0) + 1)));
      await A.store.settled();
    }
    D.net.offline = false;
    await D.store.resume();
    await D.store.settled();
    const s = server(api);
    expect([s.xp, s.rounds, s.seen[q1], s.wrong[q2]]).toEqual([50, 3, 4, 1]);
    expect(s.log.map((e) => e.q)).toEqual([q2]);
    expect(D.store.state.xp).toBe(50);
    await run(A.store);
    expect(A.store.state.xp).toBe(50);
    expect(A.store.state.wrong[q2]).toBe(1);
  });

  it("persists base and version with the save; after a reload nothing is counted twice", async () => {
    const api = new FakeApi();
    const first = tab(api);
    first.store.update((d) => void (d.xp += 30));
    await first.store.settled();
    const stored = JSON.parse(first.storage.raw.get(BASE_KEY)!) as { version: number; state: { xp: number } };
    expect(stored).toMatchObject({ version: api.version, state: { xp: 30 } });
    // reload while offline and play, then reload again and come back online
    const second = tab(api, first.storage);
    second.net.offline = true;
    second.store.update((d) => void (d.xp += 10));
    await second.store.settled();
    expect(JSON.parse(first.storage.raw.get(BASE_KEY)!)).toMatchObject({ version: stored.version, state: { xp: 30 } });
    const third = tab(api, first.storage);
    expect(third.store.state.xp).toBe(40);
    await run(third.store);
    expect(server(api).xp).toBe(40);
    expect(JSON.parse(first.storage.raw.get(BASE_KEY)!)).toMatchObject({ version: api.version, state: { xp: 40 } });
    await run(tab(api, first.storage).store);
    expect(server(api).xp).toBe(40);
  });

  it("a server copy older than the base (device forgotten) gets the whole local save", async () => {
    const api = new FakeApi();
    const first = tab(api);
    first.store.update((d) => void (d.xp += 30));
    await first.store.settled();
    first.store.update((d) => void (d.xp += 5));
    await first.store.settled();
    // a new anonymous device on the server: version 0, nothing saved
    api.state = {};
    api.version = 0;
    await run(tab(api, first.storage).store);
    expect(server(api).xp).toBe(35);
  });

  it("the device copy deleted while the base stays: the server copy comes back, misses included", async () => {
    const api = new FakeApi();
    const first = tab(api);
    first.store.update((d) => void ((d.xp += 30), (d.wrong[q1] = 1)));
    await first.store.settled();
    first.storage.raw.delete(LS_KEY);
    const again = tab(api, first.storage);
    await run(again.store);
    expect(again.store.state.xp).toBe(30);
    expect(server(api).xp).toBe(30);
    expect(server(api).wrong[q1]).toBe(1);
  });

  describe("two tabs sharing one device's storage (AUD-09 merge plus rebase)", () => {
    for (const seesOther of [true, false]) {
      it(`each earns +10 offline, both sync: the server ends at +20, not +40 or +10 (${seesOther ? "with" : "without"} a storage event in between)`, async () => {
        const api = new FakeApi();
        api.state = { ...emptyState(), xp: 100, ts: 1 };
        const storage = memStorage();
        const lock = deviceLock();
        const A = tab(api, storage, lock);
        const B = tab(api, storage, lock);
        await run(A.store);
        await run(B.store);
        expect(server(api).xp).toBe(100);
        A.net.offline = B.net.offline = true;
        A.store.update((d) => void (d.xp += 10));
        if (seesOther) B.store.absorbStored();
        B.store.update((d) => void (d.xp += 10));
        if (seesOther) A.store.absorbStored();
        await Promise.all([A.store.settled(), B.store.settled()]);
        expect(JSON.parse(storage.raw.get(LS_KEY)!).xp).toBe(120);
        A.net.offline = B.net.offline = false;
        await Promise.all([A.store.resume(), B.store.resume()]);
        await Promise.all([A.store.settled(), B.store.settled()]);
        await run(A.store);
        await run(B.store);
        expect(server(api).xp).toBe(120);
        expect(A.store.state.xp).toBe(120);
        expect(B.store.state.xp).toBe(120);
      });
    }

    it("the storage event takes the other tab's copy but never moves the base", async () => {
      const api = new FakeApi();
      const storage = memStorage();
      const lock = deviceLock();
      const A = tab(api, storage, lock);
      const B = tab(api, storage, lock);
      await run(A.store);
      const base = storage.raw.get(BASE_KEY);
      B.net.offline = true;
      B.store.update((d) => void (d.xp += 10));
      A.store.absorbStored();
      expect(A.store.state.xp).toBe(10);
      expect(storage.raw.get(BASE_KEY)).toBe(base);
      await run(A.store);
      expect(server(api).xp).toBe(10);
    });
  });
});

describe("storage helpers", () => {
  it("memStorage reads back what it was given", () => {
    expect(memStorage({ a: "1" }).getItem("a")).toBe("1");
  });
});
