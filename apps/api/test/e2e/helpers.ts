import "reflect-metadata";
import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { AppModule } from "../../src/app.module.js";
import { setupApp } from "../../src/setup-app.js";
import { ENV } from "../../src/common/tokens.js";
import { loadEnv, type Env } from "../../src/env.js";
import { PrismaService } from "../../src/prisma/prisma.service.js";
import { COACH_CLIENT, COACH_CONFIG } from "../../src/modules/coach/coach.tokens.js";
import { coachConfig, type CoachConfig } from "../../src/modules/coach/coach.config.js";
import type { CoachClient } from "../../src/modules/coach/coach.client.js";
import { testDatabaseUrl } from "./global-setup.js";

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  env: Env;
  close(): Promise<void>;
}

export async function makeApp(
  opts: { env?: Record<string, string>; coachClient?: CoachClient | null; coach?: Partial<CoachConfig> } = {},
): Promise<TestApp> {
  const env = loadEnv({
    DATABASE_URL: testDatabaseUrl(),
    WEB_ORIGIN: "http://localhost:3000",
    // the suites create many devices and coach calls from 127.0.0.1; abuse.e2e.ts restores the real defaults
    DEVICE_CREATE_PER_IP_PER_HOUR: "100000",
    COACH_IP_PER_MIN: "100000",
    COACH_DEVICE_PER_DAY: "100000",
    COACH_GLOBAL_PER_DAY: "100000",
    ...opts.env,
  });
  let mb = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ENV)
    .useValue(env)
    .overrideProvider(COACH_CONFIG)
    .useValue({ ...coachConfig, backoffMs: 1, ...opts.coach });
  if (opts.coachClient !== undefined) mb = mb.overrideProvider(COACH_CLIENT).useValue(opts.coachClient);
  const mod = await mb.compile();
  const app = mod.createNestApplication({ bodyParser: false });
  setupApp(app, env);
  await app.init();
  return { app, prisma: app.get(PrismaService), env, close: () => app.close() };
}
