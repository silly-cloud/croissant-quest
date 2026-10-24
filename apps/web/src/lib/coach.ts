import type { Question } from "@cq/content";
import { API_PREFIX, CoachExplainResponse, CoachRoundResponse } from "@cq/shared";

export const COACH_TIMEOUT_MS = 30_000;

type Fetch = typeof fetch;

async function post(fetchFn: Fetch, path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
  const res = await fetchFn(API_PREFIX + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal,
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error(path + " " + res.status);
  return res.json();
}

/** Run `fn` with an AbortSignal that fires after `ms`, or when `outer` aborts. */
export async function withTimeout<T>(ms: number, outer: AbortSignal | undefined, fn: (s: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  const onOuter = () => ctl.abort();
  outer?.addEventListener("abort", onOuter);
  if (outer?.aborted) ctl.abort();
  try {
    return await fn(ctl.signal);
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onOuter);
  }
}

/**
 * Fresh questions from the coach. Returns null on ANY problem (no key, timeout, bad JSON,
 * network down): the caller then drills locally, so the button is never dead.
 */
export async function requestCoachRound(
  fetchFn: Fetch,
  opts: { n?: number; focus?: string[]; signal?: AbortSignal; timeoutMs?: number },
): Promise<Question[] | null> {
  try {
    const body = { n: opts.n ?? 8, focus: (opts.focus ?? []).slice(0, 6) };
    const json = await withTimeout(opts.timeoutMs ?? COACH_TIMEOUT_MS, opts.signal, (s) => post(fetchFn, "/coach/round", body, s));
    const r = CoachRoundResponse.safeParse(json);
    if (!r.success || r.data.fallback) return null;
    // never counted as "seen" and never queued in Weak Spots: they are not in the bank
    return r.data.questions.map((q) => ({ ...q, _ai: true }));
  } catch {
    return null;
  }
}

/** "Why yours missed" for typed answers. null = nothing to show. */
export async function requestExplain(fetchFn: Fetch, qid: string, gave: string, timeoutMs = 12_000): Promise<string | null> {
  try {
    const json = await withTimeout(timeoutMs, undefined, (s) => post(fetchFn, "/coach/explain", { qid, gave: gave.slice(0, 60) }, s));
    const r = CoachExplainResponse.safeParse(json);
    return r.success && !r.data.fallback && r.data.text.trim() ? r.data.text : null;
  } catch {
    return null;
  }
}
