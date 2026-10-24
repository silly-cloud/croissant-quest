import type { INestApplication } from "@nestjs/common";
import cookieParser from "cookie-parser";
import { json } from "express";
import { API_PREFIX } from "@cq/shared";
import { AllExceptionsFilter } from "./common/http-exception.filter.js";

/** Everything main.ts and the e2e tests share. */
export function setupApp(app: INestApplication, webOrigin: string): void {
  app.setGlobalPrefix(API_PREFIX.replace(/^\//, ""));
  app.use(json({ limit: "256kb" }));
  app.use(cookieParser());
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: string | false) => void) =>
      cb(null, origin === webOrigin ? webOrigin : false),
    credentials: true,
    methods: ["GET", "PUT", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "If-Match", "If-None-Match"],
    exposedHeaders: ["ETag"],
  });
  app.useGlobalFilters(new AllExceptionsFilter());
}
