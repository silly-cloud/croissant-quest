import { HttpException, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import type { CoachConfig } from "./coach.config.js";
import { ENV } from "../../common/tokens.js";
import type { Env } from "../../env.js";
import { COACH_CONFIG } from "./coach.tokens.js";
import type { DeviceRequest } from "../device/device.guard.js";

/**
 * Fixed-window counter per key. In memory: fine for one API process (ADR 0009).
 * At `maxKeys` it refuses new keys instead of evicting old ones, so a blocked key can never be
 * reset by flooding the map with other keys.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private nextSweep: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxKeys = 10_000,
  ) {
    this.nextSweep = this.now() + windowMs;
  }

  get size(): number {
    return this.hits.size;
  }

  /** 0 when `key` may take one more, otherwise the seconds to wait. Counts nothing. */
  peek(key: string): number {
    const t = this.now();
    if (t >= this.nextSweep) {
      // at most once per window: O(keys) work is not paid on every call
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
      this.nextSweep = t + this.windowMs;
    }
    const cur = this.hits.get(key);
    if (cur && cur.resetAt > t) return cur.count >= this.limit ? this.secs(cur.resetAt - t) : 0;
    if (cur || this.hits.size < this.maxKeys) return 0;
    // full: reuse the oldest slot only if its window is over (Map keeps insertion order)
    const oldest = this.hits.entries().next().value;
    if (oldest && oldest[1].resetAt <= t) {
      this.hits.delete(oldest[0]);
      return 0;
    }
    return oldest ? this.secs(oldest[1].resetAt - t) : 0;
  }

  /** Returns 0 when allowed (and counts it), otherwise the seconds to wait. */
  take(key: string): number {
    const wait = this.peek(key);
    if (wait > 0) return wait;
    const t = this.now();
    const cur = this.hits.get(key);
    if (cur && cur.resetAt > t) cur.count++;
    else {
      this.hits.delete(key);
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
    }
    return 0;
  }

  private secs(ms: number): number {
    return Math.max(1, Math.ceil(ms / 1000));
  }
}

/** All limiters must allow the call; only then is it counted against each (a refusal spends nothing). */
export function takeAll(checks: [RateLimiter, string][]): number {
  const wait = Math.max(0, ...checks.map(([l, k]) => l.peek(k)));
  if (wait > 0) return wait;
  for (const [l, k] of checks) l.take(k);
  return 0;
}

export function tooMany(res: Response, wait: number, message: string): HttpException {
  res.setHeader("Retry-After", String(wait));
  return new HttpException({ statusCode: 429, error: "Too Many Requests", message }, 429);
}

const GLOBAL_KEY = "*";
const DAY_MS = 86_400_000;

/**
 * Coach quotas (ADR 0009), all checked on every call: per device per minute and per day, per client
 * IP per minute, and a global per-minute and per-day budget. Minting new device cookies resets none
 * of them: the IP and global budgets do not care which cookie is presented.
 */
@Injectable()
export class CoachRateLimitGuard implements CanActivate {
  private readonly deviceMin: RateLimiter;
  private readonly deviceDay: RateLimiter;
  private readonly ipMin: RateLimiter;
  private readonly globalMin: RateLimiter;
  private readonly globalDay: RateLimiter;

  constructor(@Inject(COACH_CONFIG) cfg: CoachConfig, @Inject(ENV) env: Env) {
    this.deviceMin = new RateLimiter(cfg.rateLimit.limit, cfg.rateLimit.windowMs);
    this.deviceDay = new RateLimiter(env.COACH_DEVICE_PER_DAY, DAY_MS);
    this.ipMin = new RateLimiter(env.COACH_IP_PER_MIN, 60_000);
    this.globalMin = new RateLimiter(env.COACH_GLOBAL_PER_MIN, 60_000);
    this.globalDay = new RateLimiter(env.COACH_GLOBAL_PER_DAY, DAY_MS);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const http = ctx.switchToHttp();
    const req = http.getRequest<DeviceRequest>();
    // RequireDeviceGuard runs first, so userId is always set here
    const device = `u:${req.userId ?? "none"}`;
    // Express resolves req.ip per `trust proxy`
    const ip = `ip:${req.ip ?? "unknown"}`;
    const wait = takeAll([
      [this.deviceMin, device],
      [this.deviceDay, device],
      [this.ipMin, ip],
      [this.globalMin, GLOBAL_KEY],
      [this.globalDay, GLOBAL_KEY],
    ]);
    if (wait > 0) throw tooMany(http.getResponse<Response>(), wait, "Coach rate limit reached, try again later");
    return true;
  }
}
