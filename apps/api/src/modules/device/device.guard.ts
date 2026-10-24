import { randomBytes } from "node:crypto";
import { Inject, Injectable, createParamDecorator, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request, Response } from "express";
import { DEVICE_COOKIE } from "@cq/shared";
import type { Env } from "../../env.js";
import { ENV } from "../../common/tokens.js";
import { PrismaService } from "../../prisma/prisma.service.js";

export type DeviceRequest = Request & { userId?: string };

const ONE_YEAR_MS = 365 * 24 * 3600 * 1000;

/**
 * Anonymous identity (ADR 0004): a random token in an httpOnly cookie maps to a User row.
 * No cookie, or a token we do not know, gets a new User and a fresh cookie. The client never
 * picks its own token value, so an unknown cookie is replaced rather than stored.
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

    const presented = (req.cookies as Record<string, unknown> | undefined)?.[DEVICE_COOKIE];
    if (typeof presented === "string" && presented.length > 0 && presented.length <= 128) {
      const user = await this.prisma.user.findUnique({ where: { deviceToken: presented }, select: { id: true } });
      if (user) {
        req.userId = user.id;
        return true;
      }
    }

    const token = randomBytes(32).toString("base64url");
    const user = await this.prisma.user.create({ data: { deviceToken: token }, select: { id: true } });
    res.cookie(DEVICE_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: this.env.NODE_ENV === "production",
      maxAge: ONE_YEAR_MS,
      path: "/",
    });
    req.userId = user.id;
    return true;
  }
}

/** The authenticated device's user id (set by DeviceGuard). */
export const UserId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const id = ctx.switchToHttp().getRequest<DeviceRequest>().userId;
  if (!id) throw new Error("DeviceGuard not applied");
  return id;
});
