/**
 * The ONLY place a model id appears (ADR 0005). Change the model here and nowhere else.
 * `tier` mirrors the legacy page's TIER names: the app never asks for "complex".
 */
export const coachConfig = {
  model: "claude-sonnet-5-5",
  tier: "default",
  /** Overall deadline for one coach call, retries included. Below the web app's 30 s, so our fallback arrives first. */
  timeoutMs: 25_000,
  /**
   * The same deadline for COACH_PROVIDER=claude-cli (ADR 0011). The CLI starts a process and writes the
   * whole round before answering, so the API's 25 s timed out a real 8-question round.
   */
  cliTimeoutMs: 90_000,
  /** Extra attempts after the first, for transient failures (network, 429, 5xx). */
  retries: 2,
  /** First backoff; doubles each retry (500 ms, 1 s). */
  backoffMs: 500,
  maxTokens: { round: 8000, explain: 300 },
  /** Per device per window, shared by /coach/round and /coach/explain. Daily, per-IP and global limits are env (ADR 0009). */
  rateLimit: { limit: 10, windowMs: 60_000 },
} as const;

export interface CoachConfig {
  model: string;
  tier: string;
  timeoutMs: number;
  cliTimeoutMs: number;
  retries: number;
  backoffMs: number;
  maxTokens: { round: number; explain: number };
  rateLimit: { limit: number; windowMs: number };
}

/** The config CoachService runs with: the local Claude CLI gets its own, longer deadline (ADR 0011). */
export function coachConfigFor(
  provider: "anthropic" | "claude-cli"
): CoachConfig {
  return provider === "claude-cli"
    ? { ...coachConfig, timeoutMs: coachConfig.cliTimeoutMs }
    : coachConfig;
}
