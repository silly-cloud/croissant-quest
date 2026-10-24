import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

/** e2e runs against its own database (default cq_test on the same server) and never touches cq_dev. */
export const TEST_DB = "cq_test";

export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? "postgresql://cq:cq@localhost:5432/cq_dev";
  const u = new URL(base);
  u.pathname = `/${TEST_DB}`;
  return u.toString();
}

export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [TEST_DB]);
    if (!rowCount) await client.query(`CREATE DATABASE ${TEST_DB}`);
  } finally {
    await client.end();
  }
  const cwd = fileURLToPath(new URL("../..", import.meta.url));
  execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
    cwd,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}
