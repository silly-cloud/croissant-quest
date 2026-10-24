import { defineConfig } from "prisma/config";

// No fallback database: a missing DATABASE_URL must not silently run migrate/seed against cq_dev.
// `prisma generate` needs no database, so only it may run without one.
const url = process.env.DATABASE_URL?.trim();
if (!url && !process.argv.includes("generate")) {
  throw new Error("DATABASE_URL is required (prisma.config.ts has no default database)");
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  ...(url ? { datasource: { url } } : {}),
});
