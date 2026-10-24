import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { json, type NextFunction, type Request, type Response } from "express";
import { API_PREFIX } from "@cq/shared";
import type { Env } from "./env.js";
import { AllExceptionsFilter } from "./common/http-exception.filter.js";

/**
 * Body-parser and inflate errors, answered right after json() so Nest never sees them: its adapter
 * would turn a JSON SyntaxError into a 400 that echoes fragments of the body. A bad gzip stream is a
 * client error (400), not a 500. Nothing from the error or the body is returned.
 */
function bodyErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const e = err as { status?: unknown; statusCode?: unknown; type?: unknown; code?: unknown } | null;
  const status = Number(e?.status ?? e?.statusCode);
  const zlib = typeof e?.code === "string" && e.code.startsWith("Z_");
  if (!(zlib || (status >= 400 && status < 500))) return next(err);
  const code = zlib ? 400 : status;
  const message = code === 413 ? "Payload too large" : code === 415 ? "Unsupported content encoding" : "Malformed request body";
  res.status(code).json({ statusCode: code, error: message, message });
}

/** Everything main.ts and the e2e tests share. */
export function setupApp(app: INestApplication, env: Pick<Env, "WEB_ORIGIN" | "TRUST_PROXY_HOPS">): void {
  const webOrigin = env.WEB_ORIGIN;
  const express = app as NestExpressApplication;
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""));
  express.disable("x-powered-by");
  // Express's weak ETag on /v1/progress is not the save version and only confuses If-Match; questions sets its own
  express.set("etag", false);
  // never `true`: that would trust any X-Forwarded-For and let a client pick its own rate-limit key
  if (env.TRUST_PROXY_HOPS > 0) express.set("trust proxy", env.TRUST_PROXY_HOPS);
  // every response depends on Origin (allowed or not), so a shared cache must key on it
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.vary("Origin");
    next();
  });
  // CORS first, so even a body-parser rejection (400/413) carries the CORS headers
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: string | false) => void) =>
      cb(null, origin === webOrigin ? webOrigin : false),
    credentials: true,
    methods: ["GET", "PUT", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "If-Match", "If-None-Match"],
    exposedHeaders: ["ETag", "Retry-After"],
  });
  app.use(json({ limit: "256kb" }));
  app.use(bodyErrors);
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
}
