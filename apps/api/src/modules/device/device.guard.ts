import { randomBytes } from "node:crypto";
import { Inject, Injectable, UnauthorizedException, createParamDecorator, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";
import { DEVICE_COOKIE } from "@cq/shared";
import type { Env } from "../../env.js";
import { ENV } from "../../common/tokens.js";
import { PrismaService } from "../../prisma/prisma.service.js";

export type DeviceRequest = Request & { userId?: string };

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

/** Read-only: the user id for a valid device cookie, otherwise undefined. Never writes. */
async function lookup(prisma: PrismaService, req: DeviceRequest): Promise<string | undefined> {
  const presented = (req.cookies as Record<string, unknown> | undefined)?.[DEVICE_COOKIE];
  if (typeof presented !== "string" || presented.length === 0 || presented.length > 128) return undefined;
  const user = await prisma.user.findUnique({ where: { deviceToken: presented }, select: { id: true } });
  return user?.id;
}

/**
 * Anonymous identity (ADR 0004, amended): a random token in an httpOnly cookie maps to a User row.
 * Only GET /v1/progress uses this guard: no cookie, or a token we do not know, gets a new User and a
 * fresh cookie. The client never picks its own token value, so an unknown cookie is replaced.
 */
@Injectable()
export class DeviceGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const http = ctx.switchToHttp();
    const req = http.getRequest<DeviceRequest>();
    const res = http.getResponse<Response>();

    const known = await lookup(this.prisma, req);
    if (known) {
      req.userId = known;
      return true;
    }

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

/** Writes need a device that GET /v1/progress already created: otherwise 401 `no_device`. Creates nothing. */
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

/** Coach routes: a known device is identified, anyone else is anonymous. Never creates a user. */
@Injectable()
export class OptionalDeviceGuard implements CanActivate {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<DeviceRequest>();
    req.userId = await lookup(this.prisma, req);
    return true;
  }
}

/** The authenticated device's user id (set by DeviceGuard). */
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<DeviceRequest>().userId;
  if (!id) throw new Error("DeviceGuard not applied");
  return id;
});
