import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./env.js";
import { setupApp } from "./setup-app.js";

async function bootstrap() {
  const env = loadEnv(); // fail fast on bad config, before listening
  // bodyParser off: setupApp installs json() with an explicit size limit
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  setupApp(app, env);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  new Logger("Bootstrap").log(`API listening on :${env.PORT} (coach ${env.ANTHROPIC_API_KEY ? "enabled" : "disabled: no key"})`);
}

bootstrap().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
