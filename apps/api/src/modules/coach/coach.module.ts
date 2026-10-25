import { Module } from "@nestjs/common";
import { ENV } from "../../common/tokens.js";
import type { Env } from "../../env.js";
import { ProgressModule } from "../progress/progress.module.js";
import { createCoachClient } from "./coach.client.js";
import { ClaudeCliCoachClient } from "./coach.cli-client.js";
import { coachConfigFor } from "./coach.config.js";
import { CoachController } from "./coach.controller.js";
import { CoachService } from "./coach.service.js";
import { COACH_CLIENT, COACH_CONFIG } from "./coach.tokens.js";
import { CoachRateLimitGuard } from "./rate-limit.guard.js";

@Module({
  imports: [ProgressModule],
  controllers: [CoachController],
  providers: [
    {
      provide: COACH_CONFIG,
      inject: [ENV],
      useFactory: (env: Env) => coachConfigFor(env.COACH_PROVIDER),
    },
    {
      provide: COACH_CLIENT,
      inject: [ENV],
      // the provider is chosen explicitly; there is no fallback from one to the other
      useFactory: (env: Env) =>
        env.COACH_PROVIDER === "claude-cli"
          ? new ClaudeCliCoachClient({ bin: env.CLAUDE_CLI_PATH })
          : createCoachClient(env.ANTHROPIC_API_KEY),
    },
    CoachService,
    CoachRateLimitGuard,
  ],
})
export class CoachModule {}
