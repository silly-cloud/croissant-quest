import { Global, Module } from "@nestjs/common";
import { ENV } from "./common/tokens.js";
import { loadEnv } from "./env.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { DeviceGuard, OptionalDeviceGuard, RequireDeviceGuard } from "./modules/device/device.guard.js";

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, PrismaService, DeviceGuard, RequireDeviceGuard, OptionalDeviceGuard],
  exports: [ENV, PrismaService, DeviceGuard, RequireDeviceGuard, OptionalDeviceGuard],
})
export class CoreModule {}
