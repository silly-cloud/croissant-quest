import { BANK as BUNDLED_BANK, qid, Question } from "@cq/content";
import { API_PREFIX, emptyState, mergeStates, normState, ProgressResponse, type State } from "@cq/shared";
import { z } from "zod";

/** Same key as the single-file game, so an old save on this device still loads. */
export const LS_KEY = "croissant-quest-v1";

export type SyncStatus = "idle" | "syncing" | "ok" | "error";

export interface GameSnapshot {
  state: State;
  bank: Question[];
  sync: SyncStatus;
  /** true once localStorage has been read (false during SSR and the first client render) */
  ready: boolean;
}

type KV = Pick<Storage, "getItem" | "setItem">;

export interface GameStoreDeps {
  fetch?: typeof fetch;
  /** null = no persistence (SSR, private mode) */
  storage?: KV | null;
  now?: () => number;
  /** ms before a request to the API is abandoned */
  timeoutMs?: number;
}

const MAX_PUT_TRIES = 5;

export const SERVER_SNAPSHOT: GameSnapshot = {
  state: emptyState(),
  bank: BUNDLED_BANK,
  sync: "idle",
  ready: false,
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Progress for the whole app: localStorage is the source of truth on this device, the API is merged in when reachable. */
export class GameStore {
  private snap: GameSnapshot;
  private listeners = new Set<() => void>();
  private version: number | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  private bankFromServer = false;
  private readonly fetchFn: typeof fetch;
  private readonly storage: KV | null;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private known: Set<string>;

  constructor(deps: GameStoreDeps = {}) {
    this.fetchFn = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
    this.known = new Set(BUNDLED_BANK.map(qid));
    this.snap = { state: this.loadLocal(), bank: BUNDLED_BANK, sync: "idle", ready: this.storage !== null };
  }

  /* ---------- external store plumbing ---------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;
  private set(patch: Partial<GameSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  get state(): State {
    return this.snap.state;
  }
  get bank(): Question[] {
    return this.snap.bank;
  }

  /* ---------- local copy ---------- */
  private loadLocal(): State {
    try {
      const raw = this.storage?.getItem(LS_KEY);
      if (raw) return normState(JSON.parse(raw), this.known);
    } catch {
      /* a broken save must never stop the app: start clean */
    }
    return emptyState();
  }

  private persist(s: State) {
    try {
      this.storage?.setItem(LS_KEY, JSON.stringify(s));
    } catch {
      /* storage full or blocked: the in-memory copy still plays */
    }
  }

  /**
   * Change the progress. `fn` mutates a draft (shared helpers such as noteAnswer and
   * scoreRound mutate in place). The copy is stamped, capped, written to this device,
   * and pushed to the API in the background.
   */
  update(fn: (draft: State) => void): State {
    const draft = clone(this.snap.state);
    fn(draft);
    draft.ts = Math.max(this.now(), draft.ts + 1);
    if (draft.log.length > 500) draft.log = draft.log.slice(-500);
    this.persist(draft);
    this.set({ state: draft });
    void this.sync();
    return draft;
  }

  /** Merge a copy from elsewhere (API, another tab) into ours. Counters only grow, so this never loses progress. */
  private absorb(remote: unknown) {
    const merged = mergeStates(this.snap.state, normState(remote, this.known));
    this.persist(merged);
    this.set({ state: merged });
  }

  /* ---------- API ---------- */
  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.timeoutMs);
    try {
      return await this.fetchFn(API_PREFIX + path, { ...init, signal: ctl.signal, credentials: "same-origin" });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Prefer the server's question bank when it answers; the bundled one is the offline fallback. */
  async loadBank(): Promise<void> {
    try {
      const res = await this.call("/questions", { headers: { accept: "application/json" } });
      if (!res.ok) return;
      const body: unknown = await res.json();
      const list = Array.isArray(body) ? body : (body as { questions?: unknown } | null)?.questions;
      const parsed = z.array(Question).min(1).safeParse(list);
      if (!parsed.success) return;
      this.bankFromServer = true;
      this.known = new Set(parsed.data.map(qid));
      this.set({ bank: parsed.data });
    } catch {
      /* offline: keep the bundled bank */
    }
  }
  get usingServerBank() {
    return this.bankFromServer;
  }

  /** What we upload: the log is trimmed like the single-file game did. */
  private outgoing(): State {
    const s = clone(this.snap.state);
    s.log = s.log.slice(-120);
    s.feelLog = s.feelLog.slice(-20);
    return s;
  }

  /** Serialised: only one sync runs at a time; a request made meanwhile reruns once afterwards. */
  sync(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const run = this.runSync().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.sync();
      }
    });
    this.running = run;
    return run;
  }

  /** Resolves when no sync is running and none is queued (tests, and "leave the page" flows). */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  private async runSync(): Promise<void> {
    this.set({ sync: "syncing" });
    try {
      for (let attempt = 0; attempt < MAX_PUT_TRIES; attempt++) {
        if (this.version === null) {
          const res = await this.call("/progress", { headers: { accept: "application/json" } });
          if (!res.ok) throw new Error("GET /progress " + res.status);
          const body = ProgressResponse.parse(await res.json());
          this.version = body.version;
          this.absorb(body.state);
        }
        const res = await this.call("/progress", {
          method: "PUT",
          headers: { "content-type": "application/json", "if-match": String(this.version) },
          body: JSON.stringify({ state: this.outgoing() }),
        });
        if (res.status === 409) {
          // someone else saved first: take their copy, merge, and send again
          const body = ProgressResponse.parse(await res.json());
          this.version = body.version;
          this.absorb(body.state);
          continue;
        }
        if (!res.ok) throw new Error("PUT /progress " + res.status);
        const body = ProgressResponse.parse(await res.json());
        this.version = body.version;
        this.absorb(body.state);
        this.set({ sync: "ok" });
        return;
      }
      throw new Error("progress kept conflicting");
    } catch {
      this.version = null; // next time start from a fresh read
      this.set({ sync: "error" });
    }
  }
}

function safeLocalStorage(): KV | null {
  try {
    if (typeof window === "undefined") return null;
    const ls = window.localStorage;
    ls.getItem(LS_KEY);
    return ls;
  } catch {
    return null;
  }
}
