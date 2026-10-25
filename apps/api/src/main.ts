import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { AppModule } from "./app.module.js";
import { loadEnv } from "./env.js";
import { setupApp } from "./setup-app.js";
import { ClaudeCliCoachClient } from "./modules/coach/coach.cli-client.js";

/**
 * claude-cli: refuse to start unless the CLI exists and is not set to an API key or another provider.
 * Signed out is allowed (sign in any time; the coach answers login_required until then).
 */
async function checkClaudeCli(bin: string, log: Logger): Promise<void> {
  const s = await new ClaudeCliCoachClient({ bin }).authState();
  if (s.ok)
    return void log.log(
      "Claude Code CLI: signed in with a claude.ai subscription"
    );
  if (s.problem === "not_logged_in") {
    return void log.warn(
      "Claude Code CLI is not signed in: run `claude` in a terminal and type /login, then use the coach"
    );
  }
  if (s.problem === "not_subscription") {
    throw new Error(
      `Claude Code CLI uses "${s.method}", not a claude.ai login. COACH_PROVIDER=claude-cli refuses this so nothing is billed to an API account: run \`claude auth logout\`, then \`claude\` and /login with your Pro/Max account.`
    );
  }
  throw new Error(
    s.problem === "cli_missing"
      ? `Claude Code CLI not found (${bin}). Install it (npm i -g @anthropic-ai/claude-code) or set CLAUDE_CLI_PATH.`
      : "`claude auth status` gave no readable answer: update Claude Code (claude update) and try again."
  );
}

async function bootstrap() {
  const env = loadEnv(); // fail fast on bad config, before listening
  // bodyParser off: setupApp installs json() with an explicit size limit
  const log = new Logger("Bootstrap");
  if (env.COACH_PROVIDER === "claude-cli")
    await checkClaudeCli(env.CLAUDE_CLI_PATH, log);
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  setupApp(app, env);
  app.enableShutdownHooks();
  if (env.HOST) await app.listen(env.PORT, env.HOST);
  else await app.listen(env.PORT);
  const coach =
    env.COACH_PROVIDER === "claude-cli"
      ? "local Claude Code CLI, claude.ai subscription"
      : env.ANTHROPIC_API_KEY
        ? "enabled"
        : "disabled: no key";
  log.log(`API listening on ${env.HOST ?? ""}:${env.PORT} (coach ${coach})`);
}

bootstrap().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
