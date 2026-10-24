import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { json } from "express";
import { API_PREFIX } from "@cq/shared";
import type { Env } from "./env.js";
import { AllExceptionsFilter } from "./common/http-exception.filter.js";

/** Everything main.ts and the e2e tests share. */
export function setupApp(app: INestApplication, env: Pick<Env, "WEB_ORIGIN" | "TRUST_PROXY_HOPS">): void {
  const webOrigin = env.WEB_ORIGIN;
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""));
  // never `true`: that would trust any X-Forwarded-For and let a client pick its own rate-limit key
  if (env.TRUST_PROXY_HOPS > 0) (app as NestExpressApplication).set("trust proxy", env.TRUST_PROXY_HOPS);
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
  app.use(cookieParser());
  app.useGlobalFilters(new AllExceptionsFilter());
}
