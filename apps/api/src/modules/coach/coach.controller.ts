import { Body, Controller, Header, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import {
  CoachExplainBody,
  CoachRoundBody,
  type CoachExplainResponse,
  type CoachRoundResponse,
} from "@cq/shared";
import type { DeviceRequest } from "../device/device.guard.js";
import { ZodPipe } from "../../common/zod.pipe.js";
import { OptionalDeviceGuard } from "../device/device.guard.js";
import { CoachService } from "./coach.service.js";
import { CoachRateLimitGuard } from "./rate-limit.guard.js";

@Controller("coach")
@UseGuards(OptionalDeviceGuard, CoachRateLimitGuard)
export class CoachController {
  constructor(@Inject(CoachService) private readonly coach: CoachService) {}

  @Post("round")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  round(@Req() req: DeviceRequest, @Body(new ZodPipe(CoachRoundBody)) body: CoachRoundBody): Promise<CoachRoundResponse> {
    return this.coach.round(req.userId, body);
  }

  @Post("explain")
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  explain(@Body(new ZodPipe(CoachExplainBody)) body: CoachExplainBody): Promise<CoachExplainResponse> {
    return this.coach.explain(body);
  }
}
