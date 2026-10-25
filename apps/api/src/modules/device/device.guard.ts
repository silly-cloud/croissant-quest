import { randomBytes } from "node:crypto";
import { Inject, Injectable, UnauthorizedException, createParamDecorator, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";
import { DEVICE_COOKIE } from "@cq/shared";
import type { Env } from "../../env.js";
import { ENV } from "../../common/tokens.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RateLimiter, tooMany } from "../coach/rate-limit.guard.js";

export type DeviceRequest = Request & { userId?: string };

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;
const HOUR_MS = 3600 * 1000;
/** What DeviceGuard issues: 32 random bytes, base64url. Anything else (NUL, junk) is no cookie at all. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Read-only: the user id for a valid device cookie, otherwise undefined. Never writes. */
async function lookup(prisma: PrismaService, req: DeviceRequest): Promise<string | undefined> {
  const presented = (req.cookies as Record<string, unknown> | undefined)?.[DEVICE_COOKIE];
  if (typeof presented !== "string" || !TOKEN_RE.test(presented)) return undefined;
  const user = await prisma.user.findUnique({ where: { deviceToken: presented }, select: { id: true } });
  return user?.id;
}

/**
 * Anonymous identity (ADR 0004, amended): a random token in an httpOnly cookie maps to a User row.
 * Only GET /v1/progress uses this guard: no cookie, or a token we do not know, gets a new User and a
 * fresh cookie. The client never picks its own token value, so an unknown cookie is replaced.
 * Creation is limited per client IP (DEVICE_CREATE_PER_IP_PER_HOUR, ADR 0009): beyond it, 429 and no row.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  private readonly creates: RateLimiter;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.creates = new RateLimiter(env.DEVICE_CREATE_PER_IP_PER_HOUR, HOUR_MS);
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<DeviceRequest>();
    const res = http.getResponse<Response>();

    const known = await lookup(this.prisma, req);
    if (known) {
      req.userId = known;
      return true;
    }

    const wait = this.creates.take(`ip:${req.ip ?? "unknown"}`);
    if (wait > 0) throw tooMany(res, wait, "Too many new devices from this address, try again later");

    const token = randomBytes(32).toString("base64url");
    const user = await this.prisma.user.create({ data: { deviceToken: token }, select: { id: true } });
    res.cookie(DEVICE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.env.COOKIE_SECURE,
      maxAge: ONE_YEAR_MS,
      path: "/",
    });
    req.userId = user.id;
    return true;
  }
}

/** Writes and coach calls need a device that GET /v1/progress already created: otherwise 401 `no_device`. Creates nothing. */
@Injectable()
export class RequireDeviceGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<DeviceRequest>();
    const id = await lookup(this.prisma, req);
    if (!id) throw new UnauthorizedException({ statusCode: 401, error: "no_device", message: "GET /v1/progress first to get a device cookie" });
    req.userId = id;
    return true;
  }
}

/** The authenticated device's user id (set by DeviceGuard). */
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<DeviceRequest>().userId;
  if (!id) throw new Error("DeviceGuard not applied");
  return id;
});
