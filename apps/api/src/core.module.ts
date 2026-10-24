import { Global, Module } from "@nestjs/common";
import { ENV } from "./common/tokens.js";
import { loadEnv } from "./env.js";
import { PrismaService } from "./prisma/prisma.service.js";
import { DeviceGuard } from "./modules/device/device.guard.js";

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }, PrismaService, DeviceGuard],
  exports: [ENV, PrismaService, DeviceGuard],
})
export class CoreModule {}
