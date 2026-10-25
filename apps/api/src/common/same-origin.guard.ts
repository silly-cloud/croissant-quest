import { ForbiddenException, HttpException, Inject, Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import type { Env } from "../env.js";
import { ENV } from "./tokens.js";

const originOf = (url: string): string | null => {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

/**
 * State-changing routes (PUT /v1/progress, POST /v1/coach/*), ADR 0009:
 * 1. Same origin. Browsers always send `Origin` on PUT/POST fetches, so a present `Origin` must equal
 *    WEB_ORIGIN (else 403 `bad_origin`). Without it, a present `Referer` must be from WEB_ORIGIN. A request
 *    with neither header is not from a browser (server-to-server, tests) and is allowed.
 * 2. `Content-Type: application/json`, else 415. That forces a CORS preflight for any cross-site page,
 *    which kills the text/plain / form "simple request" path.
 */
@Injectable()
export class SameOriginJsonGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Pick<Env, "WEB_ORIGIN">) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const from = origin !== undefined ? origin : referer !== undefined ? originOf(referer) : undefined;
    if (from !== undefined && from !== this.env.WEB_ORIGIN) {
      throw new ForbiddenException({ statusCode: 403, error: "bad_origin", message: "Cross-site request refused" });
    }
    const type = (req.headers["content-type"] ?? "").split(";")[0]!.trim().toLowerCase();
    if (type !== "application/json") {
      throw new HttpException(
        { statusCode: 415, error: "Unsupported Media Type", message: "Content-Type must be application/json" },
        415,
      );
    }
    return true;
  }
}
