import { HttpException, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import type { CoachConfig } from "./coach.config.js";
import { ENV } from "../../common/tokens.js";
import type { Env } from "../../env.js";
import { COACH_CONFIG } from "./coach.tokens.js";
import type { DeviceRequest } from "../device/device.guard.js";

/** Fixed-window counter per key. In memory: fine for one API process, see README. */
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

  /** Returns 0 when allowed, otherwise the seconds to wait. */
  take(key: string): number {
    const t = this.now();
    if (t >= this.nextSweep) {
      // at most once per window: O(keys) work is not paid on every call
      for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
      this.nextSweep = t + this.windowMs;
    }
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.delete(key);
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      // hard cap: evict the oldest windows (Map keeps insertion order)
      for (const k of this.hits.keys()) {
        if (this.hits.size <= this.maxKeys) break;
        this.hits.delete(k);
      }
      return 0;
    }
    if (cur.count >= this.limit) return Math.max(1, Math.ceil((cur.resetAt - t) / 1000));
    cur.count++;
    return 0;
  }
}

const GLOBAL_KEY = "*";

@Injectable()
export class CoachRateLimitGuard implements CanActivate {
  private readonly limiter: RateLimiter;
  private readonly global: RateLimiter;

  constructor(@Inject(COACH_CONFIG) cfg: CoachConfig, @Inject(ENV) env: Env) {
    this.limiter = new RateLimiter(cfg.rateLimit.limit, cfg.rateLimit.windowMs);
    this.global = new RateLimiter(env.COACH_GLOBAL_PER_MIN, 60_000);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const http = ctx.switchToHttp();
    const req = http.getRequest<DeviceRequest>();
    // a known device is limited as itself, everyone else by client IP (Express resolves it per `trust proxy`)
    const key = req.userId ? `u:${req.userId}` : `ip:${req.ip ?? "unknown"}`;
    // the per-client check goes first so a blocked client does not burn the shared budget
    const wait = this.limiter.take(key) || this.global.take(GLOBAL_KEY);
    if (wait > 0) {
      http.getResponse<Response>().setHeader("Retry-After", String(wait));
      throw new HttpException(
        { statusCode: 429, error: "Too Many Requests", message: "Coach rate limit reached, try again shortly" },
        429,
      );
    }
    return true;
  }
}
