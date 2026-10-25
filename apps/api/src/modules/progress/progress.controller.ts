import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  Inject,
  Put,
  UseGuards,
} from "@nestjs/common";
import { PutProgressBody, type ProgressResponse } from "@cq/shared";
import { ZodPipe } from "../../common/zod.pipe.js";
import { DeviceGuard, RequireDeviceGuard, UserId } from "../device/device.guard.js";
import { SameOriginJsonGuard } from "../../common/same-origin.guard.js";
import { ProgressService } from "./progress.service.js";

/** `If-Match: 3`, `"3"` or `W/"3"` -> 3. */
export function parseIfMatch(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    throw new HttpException(
      { statusCode: 428, error: "Precondition Required", message: "If-Match header with the current version is required" },
      428,
    );
  }
  const m = /^\s*(?:W\/)?"?(\d{1,10})"?\s*$/.exec(raw);
  if (!m) throw new BadRequestException({ statusCode: 400, error: "Bad Request", message: "If-Match must be a version number" });
  return Number(m[1]);
}

@Controller("progress")
export class ProgressController {
  constructor(@Inject(ProgressService) private readonly progress: ProgressService) {}

  /** The only route that creates a user (and sets the cookie). */
  @Get()
  @UseGuards(DeviceGuard)
  @Header("Cache-Control", "no-store")
  get(@UserId() userId: string): Promise<ProgressResponse> {
    return this.progress.get(userId);
  }

  @Put()
  @UseGuards(SameOriginJsonGuard, RequireDeviceGuard)
  @HttpCode(200)
  @Header("Cache-Control", "no-store")
  put(
    @UserId() userId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body(new ZodPipe(PutProgressBody)) body: PutProgressBody,
  ): Promise<ProgressResponse> {
    return this.progress.put(userId, parseIfMatch(ifMatch), body.state);
  }
}
