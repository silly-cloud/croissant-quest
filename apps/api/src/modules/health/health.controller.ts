import { Controller, Get, Header, Inject } from "@nestjs/common";
import type { HealthResponse } from "@cq/shared";
import { PrismaService } from "../../prisma/prisma.service.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** Always 200; `db` says whether Postgres answered a trivial query. */
  @Get()
  @Header("Cache-Control", "no-store")
  async health(): Promise<HealthResponse> {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    return { ok: true, db };
  }
}
