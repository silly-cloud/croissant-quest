import { BANK as BUNDLED_BANK, qid, Question } from "@cq/content";
import { API_PREFIX, emptyState, normState, ProgressResponse, rebase, type State } from "@cq/shared";
import { z } from "zod";

/** Same key as the single-file game, so an old save on this device still loads. */
export const LS_KEY = "croissant-quest-v1";
/** The last server copy this device synced with, and its version: `{ version, state }` (ADR 0010). */
export const BASE_KEY = "cq.base";

/** Runs one sync at a time across this device's tabs (Web Locks); without it, each tab only serialises its own. */
export type SyncLock = <T>(fn: () => Promise<T>) => Promise<T>;
const webLock: SyncLock = (fn) => {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // request() resolves to what fn's promise resolves to; the DOM typing nests it
  return locks ? (locks.request("cq-progress-sync", fn) as Promise<never>) : fn();
};

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
  /** default: navigator.locks when the browser has it */
  lock?: SyncLock;
}

const MAX_PUT_TRIES = 5;
/** After a failed sync, wait this long before the next try; doubles per failure up to RETRY_MAX_MS. */
export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 5 * 60_000;

class SyncError extends Error {
  constructor(
    readonly status: number,
    /** ms the server asked us to wait (429/503 Retry-After) */
    readonly retryAfterMs: number | null,
  ) {
    super("progress sync " + status);
  }
}

const retryAfter = (res: Response): number | null => {
  if (res.status !== 429 && res.status !== 503) return null;
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
};

export const SERVER_SNAPSHOT: GameSnapshot = {
  state: emptyState(),
  bank: BUNDLED_BANK,
  sync: "idle",
  ready: false,
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * Progress for the whole app: localStorage is the source of truth on this device, the API is merged in when reachable.
 *
 * Two references, two merges (ADR 0010, AUD-01 and AUD-09):
 * - `base`/`version`: the last server copy and its version, persisted under BASE_KEY. Only a server response moves it.
 *   Every server copy is taken in with `rebase(server, base, local)`, so what this device played since `base` is
 *   added to the server's totals instead of maxed against them.
 * - `seen`: the device copy (LS_KEY) as this tab last read or wrote it. A write or a `storage` event replays this
 *   tab's changes since `seen` onto whatever the device copy holds now, so tabs add up too.
 * The device copy is one shared history, so a sync takes the newest base any tab stored (it pairs with the device
 * copy) and syncs run one at a time across tabs: two tabs never upload the same unsynced progress twice.
 */
export class GameStore {
  private snap: GameSnapshot;
  private listeners = new Set<() => void>();
  /** with no server copy known yet (version null) an empty state, so a pre-upgrade save counts as new once */
  private base: State;
  private version: number | null = null;
  /** read the server copy (GET) before the next PUT: first sync, and after any failure */
  private needRead = true;
  private seen: State | null = null;
  private readonly lock: SyncLock;
  private running: Promise<void> | null = null;
  private again = false;
  private bankFromServer = false;
  private readonly fetchFn: typeof fetch;
  private readonly storage: KV | null;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private known: Set<string>;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: GameStoreDeps = {}) {
    this.fetchFn = deps.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
    this.storage = deps.storage === undefined ? safeLocalStorage() : deps.storage;
    this.now = deps.now ?? Date.now;
    this.timeoutMs = deps.timeoutMs ?? 10_000;
    this.lock = deps.lock ?? webLock;
    this.known = new Set(BUNDLED_BANK.map(qid));
    this.base = normState({});
    const stored = this.loadBase();
    if (stored) [this.base, this.version] = [stored.state, stored.version];
    // no device copy but a base: nothing unsynced here, start from the server copy we know
    const local = this.readLocal() ?? (stored ? clone(stored.state) : emptyState());
    this.seen = this.storage ? local : null;
    this.snap = { state: local, bank: BUNDLED_BANK, sync: "idle", ready: this.storage !== null };
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
  /** The device copy, or null when there is none (or it is broken: a broken save must never stop the app). */
  private readLocal(): State | null {
    try {
      const raw = this.storage?.getItem(LS_KEY);
      if (raw) return normState(JSON.parse(raw), this.known);
    } catch {
      /* start clean */
    }
    return null;
  }

  private loadBase(): { state: State; version: number } | null {
    try {
      const raw = this.storage?.getItem(BASE_KEY);
      const v = raw ? (JSON.parse(raw) as { version?: unknown; state?: unknown }) : null;
      if (v && Number.isSafeInteger(v.version) && (v.version as number) >= 0)
        return { state: normState(v.state, this.known), version: v.version as number };
    } catch {
      /* unreadable: as if never synced */
    }
    return null;
  }

  /** This tab's changes since it last saw the device copy, replayed onto the device copy as it is now (AUD-09). */
  private onDevice(s: State): State {
    const stored = this.readLocal();
    return stored && this.seen ? normState(rebase(stored, this.seen, s), this.known) : s;
  }

  /** Write to this device without dropping what another tab stored meanwhile. Returns what was written. */
  private persist(s: State): State {
    const out = this.onDevice(s);
    try {
      this.storage?.setItem(LS_KEY, JSON.stringify(out));
      if (this.storage) this.seen = out;
    } catch {
      /* storage full or blocked: the in-memory copy still plays */
    }
    return out;
  }

  /**
   * Another tab wrote this device's copy (the `storage` event): take its progress in. Writes nothing, so tabs
   * never ping-pong, and leaves `base` alone: that moves only with a server response.
   */
  absorbStored() {
    const out = this.onDevice(this.snap.state);
    if (this.storage && this.readLocal()) this.seen = out;
    this.set({ state: out });
  }

  /** The base another tab stored is newer than ours: it pairs with the device copy, so take both. */
  private adoptStoredBase() {
    const stored = this.loadBase();
    if (!stored || (this.version !== null && stored.version <= this.version)) return;
    this.absorbStored();
    [this.base, this.version] = [stored.state, stored.version];
  }

  /** Remember a server copy as the base, with its version; never overwrite a newer one another tab stored. */
  private setBase(server: State, version: number) {
    [this.base, this.version] = [server, version];
    const stored = this.loadBase();
    if (stored && stored.version > version) return;
    try {
      this.storage?.setItem(BASE_KEY, JSON.stringify({ version, state: server }));
    } catch {
      /* storage full: the base is still right for this visit */
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
    const saved = this.persist(draft);
    this.set({ state: saved });
    // after a failure, the one retry timer sends the latest copy: no new request per answer (E-web-4)
    if (!this.retryTimer) void this.sync();
    return saved;
  }

  /**
   * Take in a server copy: replay what this device did since `ref` (the copy the server's state descends from)
   * onto it, save that on the device, then make the server copy the base. Device copy first, so a tab that
   * adopts the stored base always finds the progress it pairs with.
   */
  private takeServer(body: ProgressResponse, ref: State) {
    const server = normState(body.state, this.known);
    const next = normState(rebase(server, ref, this.snap.state), this.known);
    this.set({ state: this.persist(next) });
    this.setBase(server, body.version);
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
        // a failed run already scheduled the retry that will send this change
        if (!this.retryTimer) void this.sync();
      }
    });
    this.running = run;
    return run;
  }

  /** Try now instead of waiting for the retry timer (the browser came back online). */
  resume(): Promise<void> {
    this.clearRetry();
    return this.sync();
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** One timer at a time; the wait doubles per failure, and a server's Retry-After is honoured. */
  private scheduleRetry(serverWaitMs: number | null) {
    this.clearRetry();
    this.failures++;
    const backoff = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (this.failures - 1));
    const wait = Math.min(RETRY_MAX_MS, Math.max(backoff, serverWaitMs ?? 0));
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.sync();
    }, wait);
  }

  /** Resolves when no sync is running and none is queued (tests, and "leave the page" flows). */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  /** The client contract of ADR 0010: GET, then PUT with If-Match, rebasing onto every server copy that comes back. */
  private async exchange(): Promise<void> {
    // another tab may have synced since we last did: start from its base and the device copy it wrote
    this.absorbStored();
    this.adoptStoredBase();
    for (let attempt = 0; attempt < MAX_PUT_TRIES; attempt++) {
      if (this.needRead) {
        const res = await this.call("/progress", { headers: { accept: "application/json" } });
        if (!res.ok) throw new SyncError(res.status, retryAfter(res));
        const body = ProgressResponse.parse(await res.json());
        // a server copy older than our base (the device was forgotten) does not descend from it: all of ours is new
        const ref = this.version !== null && body.version < this.version ? normState({}) : this.base;
        this.takeServer(body, ref);
        this.needRead = false;
      }
      const sent = this.outgoing();
      const res = await this.call("/progress", {
        method: "PUT",
        headers: { "content-type": "application/json", "if-match": String(this.version) },
        body: JSON.stringify({ state: sent }),
      });
      if (res.status === 409) {
        // someone else saved first: replay ours since base onto their copy, and send again
        const body = ProgressResponse.parse(await res.json());
        this.adoptStoredBase();
        this.takeServer(body, this.base);
        continue;
      }
      if (!res.ok) throw new SyncError(res.status, retryAfter(res));
      // keeps what was played while the request was out (and the older log lines we never upload)
      this.takeServer(ProgressResponse.parse(await res.json()), sent);
      return;
    }
    throw new Error("progress kept conflicting");
  }

  private async runSync(): Promise<void> {
    this.set({ sync: "syncing" });
    try {
      await this.lock(() => this.exchange());
      this.failures = 0;
      this.clearRetry();
      this.set({ sync: "ok" });
    } catch (e) {
      this.needRead = true; // next time start from a fresh read
      this.set({ sync: "error" });
      this.scheduleRetry(e instanceof SyncError ? e.retryAfterMs : null);
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
