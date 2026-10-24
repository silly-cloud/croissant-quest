import { Module } from "@nestjs/common";
import { ENV } from "../../common/tokens.js";
import type { Env } from "../../env.js";
import { ProgressModule } from "../progress/progress.module.js";
import { createCoachClient } from "./coach.client.js";
import { coachConfig } from "./coach.config.js";
import { CoachController } from "./coach.controller.js";
import { CoachService } from "./coach.service.js";
import { COACH_CLIENT, COACH_CONFIG } from "./coach.tokens.js";
import { CoachRateLimitGuard } from "./rate-limit.guard.js";

@Module({
  imports: [ProgressModule],
  controllers: [CoachController],
  providers: [
    { provide: COACH_CONFIG, useValue: coachConfig },
    { provide: COACH_CLIENT, inject: [ENV], useFactory: (env: Env) => createCoachClient(env.ANTHROPIC_API_KEY) },
    CoachService,
    CoachRateLimitGuard,
  ],
})
export class CoachModule {}
