import { Module } from "@nestjs/common";
import { CoreModule } from "./core.module.js";
import { CoachModule } from "./modules/coach/coach.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { ProgressModule } from "./modules/progress/progress.module.js";
import { QuestionsModule } from "./modules/questions/questions.module.js";

@Module({ imports: [CoreModule, HealthModule, ProgressModule, QuestionsModule, CoachModule] })
export class AppModule {}
