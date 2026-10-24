/**
 * The ONLY place a model id appears (ADR 0005). Change the model here and nowhere else.
 * `tier` mirrors the legacy page's TIER names: the app never asks for "complex".
 */
export const coachConfig = {
  model: "claude-sonnet-5-5",
  tier: "default",
  /** Overall deadline for one coach call, retries included. The web app also gives up at 30 s. */
  timeoutMs: 30_000,
  /** Extra attempts after the first, for transient failures (network, 429, 5xx). */
  retries: 2,
  /** First backoff; doubles each retry (500 ms, 1 s). */
  backoffMs: 500,
  maxTokens: { round: 2500, explain: 300 },
  /** Per device, shared by /coach/round and /coach/explain. */
  rateLimit: { limit: 10, windowMs: 60_000 },
} as const;

export interface CoachConfig {
  model: string;
  tier: string;
  timeoutMs: number;
  retries: number;
  backoffMs: number;
  maxTokens: { round: number; explain: number };
  rateLimit: { limit: number; windowMs: number };
}
