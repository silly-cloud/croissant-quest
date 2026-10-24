import { HttpException, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Response } from "express";
import type { CoachConfig } from "./coach.config.js";
import { COACH_CONFIG } from "./coach.tokens.js";
import type { DeviceRequest } from "../device/device.guard.js";

/** Fixed-window counter per device. In memory: fine for one API process, see README. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Returns 0 when allowed, otherwise the seconds to wait. */
  take(key: string): number {
    const t = this.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return 0;
    }
    if (cur.count >= this.limit) return Math.max(1, Math.ceil((cur.resetAt - t) / 1000));
    cur.count++;
    return 0;
  }
}

@Injectable()
export class CoachRateLimitGuard implements CanActivate {
  private readonly limiter: RateLimiter;

  constructor(@Inject(COACH_CONFIG) cfg: CoachConfig) {
    this.limiter = new RateLimiter(cfg.rateLimit.limit, cfg.rateLimit.windowMs);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const http = ctx.switchToHttp();
    const key = http.getRequest<DeviceRequest>().userId ?? "anon";
    const wait = this.limiter.take(key);
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
