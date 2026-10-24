import { Module } from "@nestjs/common";
import { QuestionsController } from "./questions.controller.js";

@Module({ controllers: [QuestionsController] })
export class QuestionsModule {}
