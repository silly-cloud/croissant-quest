// Real-API e2e (playwright.real.config.ts): its own Postgres database, the real NestJS API, and the web
// app built with API_URL pointing at it. Everything started here is stopped, and the database dropped,
// by the function this returns (Playwright runs it as the global teardown).
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { API_PORT, REAL_DB, WEB_ORIGIN, WEB_PORT } from "./env";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
const root = path.resolve(web, "../..");
const logs = path.join(web, ".e2e-real");

/** Admin URL (role must be allowed to CREATE DATABASE). Never the database the tests use. */
const adminUrl =
  process.env.DATABASE_URL ?? "postgresql://cq:cq@localhost:5432/cq_dev";
const dbUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${REAL_DB}`;
  return u.toString();
})();
type Env = Record<string, string>;
const psql = (sql: string) =>
  execFileSync("psql", [adminUrl, "-v", "ON_ERROR_STOP=1", "-qc", sql], {
    stdio: "pipe",
  });

function run(cmd: string, args: string[], env: Env, cwd = root) {
  const log = path.join(
    logs,
    `${args
      .join("-")
      .replace(/[^\w-]/g, "_")
      .slice(0, 60)}.log`
  );
  try {
    execFileSync(cmd, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", fs.openSync(log, "w"), fs.openSync(log, "a")],
    });
  } catch (e) {
    throw new Error(
      `${cmd} ${args.join(" ")} failed, see ${log}\n${fs.readFileSync(log, "utf8").slice(-3000)}`,
      { cause: e }
    );
  }
}

function start(
  name: string,
  cmd: string,
  args: string[],
  env: Env,
  cwd: string
): ChildProcess {
  const out = fs.openSync(path.join(logs, `${name}.log`), "w");
  // own process group, so teardown can stop the whole tree (pnpm -> node)
  return spawn(cmd, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", out, out],
    detached: true,
  });
}

async function waitFor(
  url: string,
  child: ChildProcess,
  name: string,
  ms = 120_000
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null)
      throw new Error(
        `${name} exited early (${child.exitCode}), see ${logs}/${name}.log`
      );
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${name} did not answer ${url} within ${ms} ms`);
}

const stop = (c: ChildProcess | undefined) => {
  if (!c?.pid || c.exitCode !== null) return;
  try {
    process.kill(-c.pid, "SIGTERM");
  } catch {
    /* already gone */
  }
};

export default async function globalSetup() {
  fs.mkdirSync(logs, { recursive: true });
  psql(`DROP DATABASE IF EXISTS ${REAL_DB} WITH (FORCE)`);
  psql(`CREATE DATABASE ${REAL_DB}`);
  const apiEnv: Env = {
    DATABASE_URL: dbUrl,
    PORT: String(API_PORT),
    WEB_ORIGIN,
    NODE_ENV: "development",
    COOKIE_SECURE: "false",
    // no key: every coach call answers {fallback:true, reason:"no_key"} with no upstream call
    ANTHROPIC_API_KEY: "",
    // every test context is a new device from 127.0.0.1; keep the abuse limits out of the way
    DEVICE_CREATE_PER_IP_PER_HOUR: "100000",
    COACH_IP_PER_MIN: "100000",
    COACH_GLOBAL_PER_MIN: "100000",
    COACH_GLOBAL_PER_DAY: "1000000",
    COACH_DEVICE_PER_DAY: "100000",
  };
  const dropDb = () => psql(`DROP DATABASE IF EXISTS ${REAL_DB} WITH (FORCE)`);
  let api: ChildProcess | undefined;
  let next: ChildProcess | undefined;
  const teardown = async () => {
    stop(next);
    stop(api);
    await new Promise((r) => setTimeout(r, 500));
    dropDb();
  };
  try {
    run(
      "pnpm",
      ["--filter", "@cq/api", "--fail-if-no-match", "db:migrate"],
      apiEnv
    );
    run(
      "pnpm",
      ["--filter", "@cq/api", "--fail-if-no-match", "db:seed"],
      apiEnv
    );
    if (!process.env.E2E_SKIP_BUILD) {
      run(
        "pnpm",
        ["--filter", "@cq/api", "--fail-if-no-match", "build"],
        apiEnv
      );
      run("pnpm", ["--filter", "@cq/web", "--fail-if-no-match", "build"], {
        API_URL: `http://localhost:${API_PORT}`,
        NEXT_DIST_DIR: ".next-real",
      });
    }

    api = start(
      "api",
      "node",
      ["dist/main.js"],
      apiEnv,
      path.join(root, "apps/api")
    );
    await waitFor(`http://localhost:${API_PORT}/v1/health`, api, "api");
    const webEnv = {
      API_URL: `http://localhost:${API_PORT}`,
      NEXT_DIST_DIR: ".next-real",
    };
    next = start(
      "web",
      "pnpm",
      ["exec", "next", "start", "-p", String(WEB_PORT)],
      webEnv,
      web
    );
    await waitFor(`${WEB_ORIGIN}/v1/health`, next, "web");
  } catch (e) {
    await teardown();
    throw e;
  }
  return teardown;
}
