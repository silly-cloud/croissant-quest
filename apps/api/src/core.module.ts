import { Global, Module } from "@nestjs/common";
import { ENV } from "./common/tokens.js";
import { SameOriginJsonGuard } from "./common/same-origin.guard.js";
import { loadEnv } from "./env.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { DeviceGuard, RequireDeviceGuard } from "./modules/device/device.guard.js";

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, PrismaService, DeviceGuard, RequireDeviceGuard, SameOriginJsonGuard],
  exports: [ENV, PrismaService, DeviceGuard, RequireDeviceGuard, SameOriginJsonGuard],
})
export class CoreModule {}
