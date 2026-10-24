import type { Question } from "@cq/content";
import { GameStore } from "@/lib/game-store";
import { RoundEngine, type Pace, type RoundMode } from "@/lib/engine";
import { RoundHost, type HostDeps } from "@/lib/round-host";
import type { FakeApi } from "./fake-api";

export function memStorage(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    raw: m,
  };
}

export function makeStore(api?: FakeApi, seed: Record<string, string> = {}) {
  const storage = memStorage(seed);
  const store = new GameStore({ fetch: api ? api.fetch : () => Promise.reject(new TypeError("offline")), storage });
  return { store, storage };
}

export function makeHost(store: GameStore, over: Partial<HostDeps> & { pace?: Pace } = {}) {
  const { pace = "fast", ...deps } = over;
  return new RoundHost(store, { getPace: () => pace, ...deps });
}

export function makeEngine(store: GameStore, qs: Question[], mode: RoundMode = "normal", pace: Pace = "fast", topic = 6) {
  return new RoundEngine(topic, mode, qs, { store, getPace: () => pace, today: () => "2026-10-24" });
}

/** The answer that is right for this question. */
export function rightPick(q: Question): string {
  return q.k === "fix" ? q.bad!.split(" ")[0]! : q.a;
}
/** An answer that is wrong for this question. */
export function wrongPick(q: Question): string {
  if (q.k === "choice" || q.k === "fr2en") return q.o!.find((o) => o !== q.a)!;
  if (q.k === "fix") return q.s!.split(" ").find((w) => !q.bad!.split(" ").includes(w))!;
  return "zzz";
}
