import { afterEach, describe, expect, it, vi } from "vitest";
import type { ArgumentsHost } from "@nestjs/common";
import { AllExceptionsFilter } from "../../src/common/http-exception.filter.js";
import { z } from "zod";
import { BadRequestException } from "@nestjs/common";
import { loadEnv } from "../../src/env.js";
import { ZodPipe } from "../../src/common/zod.pipe.js";
import { RateLimiter } from "../../src/modules/coach/rate-limit.guard.js";
import { createCoachClient } from "../../src/modules/coach/coach.client.js";
import { coachConfig } from "../../src/modules/coach/coach.config.js";
import { parseIfMatch } from "../../src/modules/progress/progress.controller.js";
import { ProgressService, trimForStorage } from "../../src/modules/progress/progress.service.js";
import { ConflictException } from "@nestjs/common";
import { normState } from "@cq/shared";

describe("env", () => {
  it("defaults and optional key", () => {
    const e = loadEnv({ DATABASE_URL: "postgresql://x" });
    expect(e.PORT).toBe(3001);
    expect(e.WEB_ORIGIN).toBe("http://localhost:3000");
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(loadEnv({ DATABASE_URL: "postgresql://x", ANTHROPIC_API_KEY: "  " }).ANTHROPIC_API_KEY).toBeUndefined();
    expect(loadEnv({ DATABASE_URL: "postgresql://x", PORT: "4000" }).PORT).toBe(4000);
  });
  it("WEB_ORIGIN is reduced to its origin; proxy, cookie and coach ceiling settings", () => {
    const base = { DATABASE_URL: "postgresql://x" };
    expect(loadEnv({ ...base, WEB_ORIGIN: "https://app.example.com/some/path/?q=1" }).WEB_ORIGIN).toBe("https://app.example.com");
    expect(loadEnv(base)).toMatchObject({ TRUST_PROXY_HOPS: 0, COACH_GLOBAL_PER_MIN: 120, COOKIE_SECURE: false });
    expect(loadEnv({ ...base, NODE_ENV: "production" }).COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...base, NODE_ENV: "production", COOKIE_SECURE: "false" }).COOKIE_SECURE).toBe(false);
    expect(loadEnv({ ...base, COOKIE_SECURE: "true" }).COOKIE_SECURE).toBe(true);
    expect(loadEnv({ ...base, TRUST_PROXY_HOPS: "2", COACH_GLOBAL_PER_MIN: "7" })).toMatchObject({ TRUST_PROXY_HOPS: 2, COACH_GLOBAL_PER_MIN: 7 });
    expect(() => loadEnv({ ...base, TRUST_PROXY_HOPS: "-1" })).toThrow();
  });
  it("abuse limits: defaults and overrides (ADR 0009)", () => {
    const base = { DATABASE_URL: "postgresql://x" };
    expect(loadEnv(base)).toMatchObject({
      COACH_DEVICE_PER_DAY: 50,
      COACH_IP_PER_MIN: 20,
      COACH_GLOBAL_PER_DAY: 500,
      DEVICE_CREATE_PER_IP_PER_HOUR: 20,
    });
    const e = loadEnv({ ...base, COACH_DEVICE_PER_DAY: "5", COACH_IP_PER_MIN: "6", COACH_GLOBAL_PER_DAY: "7", DEVICE_CREATE_PER_IP_PER_HOUR: "8" });
    expect(e).toMatchObject({ COACH_DEVICE_PER_DAY: 5, COACH_IP_PER_MIN: 6, COACH_GLOBAL_PER_DAY: 7, DEVICE_CREATE_PER_IP_PER_HOUR: 8 });
    expect(() => loadEnv({ ...base, COACH_IP_PER_MIN: "0" })).toThrow(/COACH_IP_PER_MIN/);
  });
  it("WEB_ORIGIN must be http(s) (D-api-7)", () => {
    const base = { DATABASE_URL: "postgresql://x" };
    for (const bad of ["file:///etc/x", "javascript:alert(1)", "data:text/plain,x", "ftp://example.com"])
      expect(() => loadEnv({ ...base, WEB_ORIGIN: bad }), bad).toThrow(/WEB_ORIGIN/);
    expect(loadEnv({ ...base, WEB_ORIGIN: "https://a.example" }).WEB_ORIGIN).toBe("https://a.example");
  });
  it("fails fast without DATABASE_URL, and the message never echoes the key", () => {
    expect(() => loadEnv({ ANTHROPIC_API_KEY: "sk-ant-abc" })).toThrow(/DATABASE_URL/);
    try {
      loadEnv({ ANTHROPIC_API_KEY: "sk-ant-abc", PORT: "nope" });
    } catch (e) {
      expect(String(e)).not.toContain("sk-ant-abc");
    }
  });
});

describe("ZodPipe", () => {
  const pipe = new ZodPipe(z.object({ n: z.number() }));
  it("passes valid, rejects invalid with issues", () => {
    expect(pipe.transform({ n: 1 })).toEqual({ n: 1 });
    try {
      pipe.transform({ n: "x" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect((e as BadRequestException).getResponse()).toMatchObject({ statusCode: 400, issues: [{ path: ["n"] }] });
    }
  });
});

describe("RateLimiter", () => {
  it("allows `limit` per window per key, then reports seconds to wait, then resets", () => {
    let now = 0;
    const rl = new RateLimiter(2, 60_000, () => now);
    expect(rl.take("a")).toBe(0);
    expect(rl.take("a")).toBe(0);
    expect(rl.take("a")).toBe(60);
    expect(rl.take("b")).toBe(0);
    now = 60_001;
    expect(rl.take("a")).toBe(0);
  });
  it("sweeps expired keys at most once per window; at the size cap it refuses new keys", () => {
    let now = 0;
    const rl = new RateLimiter(1, 1000, () => now, 50);
    for (let i = 0; i < 40; i++) rl.take("k" + i);
    expect(rl.size).toBe(40);
    now = 500; // inside the first window: no sweep
    rl.take("x");
    now = 1001; // all expired; one sweep happens now
    rl.take("y");
    expect(rl.size).toBe(2); // x (live) and y
    for (let i = 0; i < 500; i++) rl.take("flood" + i); // same window: never above the cap
    expect(rl.size).toBe(50);
  });
  it("a blocked key stays blocked however many other keys arrive (D-api-11: no eviction)", () => {
    let now = 0;
    const rl = new RateLimiter(1, 60_000, () => now, 3);
    expect(rl.take("victim")).toBe(0);
    expect(rl.take("victim")).toBe(60);
    expect(rl.take("a")).toBe(0);
    expect(rl.take("b")).toBe(0);
    expect(rl.take("c")).toBeGreaterThan(0); // full: refused, nothing evicted
    expect(rl.take("victim")).toBeGreaterThan(0);
    now = 60_000; // the oldest window has expired: its slot can be reused
    expect(rl.take("c")).toBe(0);
  });
  it("peek reports the wait without counting", () => {
    const rl = new RateLimiter(1, 60_000, () => 0);
    expect(rl.peek("a")).toBe(0);
    expect(rl.peek("a")).toBe(0);
    expect(rl.take("a")).toBe(0);
    expect(rl.peek("a")).toBe(60);
  });
});

describe("coach config / client", () => {
  it("no key means no client; the model id lives in config only", () => {
    expect(createCoachClient(undefined)).toBeNull();
    expect(createCoachClient("sk-ant-x")).not.toBeNull();
    expect(typeof coachConfig.model).toBe("string");
    expect(coachConfig).toMatchObject({ tier: "default", retries: 2 });
  });
  it("the server gives up (25 s) before the web client (30 s), so its fallback arrives (D-api-9)", () => {
    expect(coachConfig.timeoutMs).toBe(25_000);
  });
});

describe("If-Match", () => {
  it("parses plain, quoted and weak forms; 428 when missing; 400 when garbage", () => {
    expect(parseIfMatch("3")).toBe(3);
    expect(parseIfMatch('"3"')).toBe(3);
    expect(parseIfMatch('W/"12"')).toBe(12);
    expect(() => parseIfMatch(undefined)).toThrow(expect.objectContaining({ status: 428 }));
    expect(() => parseIfMatch("")).toThrow(expect.objectContaining({ status: 428 }));
    expect(() => parseIfMatch("-1")).toThrow(BadRequestException);
    expect(() => parseIfMatch("1.5")).toThrow(BadRequestException);
  });
});

describe("storage trim", () => {
  it("keeps the newest 120 log entries (normState already caps feelLog at 20)", () => {
    const s = normState({
      log: Array.from({ length: 130 }, (_, i) => ({ q: String(i), at: i })),
      feelLog: Array.from({ length: 25 }, (_, i) => ({ feel: i, mine: i })),
    });
    const t = trimForStorage(s);
    expect(t.log).toHaveLength(120);
    expect(t.log[0]).toMatchObject({ q: "10" });
    expect(t.feelLog).toHaveLength(20);
  });
});

describe("ProgressService.put compare-and-swap", () => {
  /** A one-row fake table. `onFirstRead` runs right after the service reads the row, i.e. between its read and its update. */
  function fakePrisma(onFirstRead: (row: { version: number; xp: number }) => void) {
    const row = { userId: "u", state: normState({}), version: 1, ts: 0n, xp: 0, streak: 0 };
    let reads = 0;
    const tx = {
      progress: {
        createMany: async () => ({ count: 0 }),
        findUniqueOrThrow: async () => {
          const snap = { ...row };
          if (++reads === 1) onFirstRead(row);
          return snap;
        },
        updateMany: async ({ where, data }: { where: { version?: number }; data: { version: number; xp: number } }) => {
          if (where.version !== undefined && where.version !== row.version) return { count: 0 };
          Object.assign(row, data);
          return { count: 1 };
        },
      },
    };
    return { row, prisma: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
  }

  it("a writer that read version 1 loses when another commit lands before its update", async () => {
    const f = fakePrisma((row) => { row.version = 2; row.xp = 999; });
    const svc = new ProgressService(f.prisma as never);
    await expect(svc.put("u", 1, { xp: 5, ts: 1 })).rejects.toBeInstanceOf(ConflictException);
    expect(f.row.version).toBe(2);
    expect(f.row.xp).toBe(999); // the loser wrote nothing
  });

  it("without interleaving the same call succeeds and bumps the version", async () => {
    const f = fakePrisma(() => undefined);
    const r = await new ProgressService(f.prisma as never).put("u", 1, { xp: 5, ts: 1 });
    expect(r.version).toBe(2);
    expect(f.row.version).toBe(2);
  });
});

describe("AllExceptionsFilter", () => {
  const run = (err: unknown) => {
    const out: { status?: number; body?: unknown } = {};
    const res = { headersSent: false, status: (n: number) => ((out.status = n), res), json: (b: unknown) => ((out.body = b), res) };
    const host = { switchToHttp: () => ({ getResponse: () => res }) } as unknown as ArgumentsHost;
    new AllExceptionsFilter().catch(err, host);
    return out;
  };
  const pgError = (code: string) =>
    Object.assign(new Error("Database error. Code: `" + code + "`"), {
      code: "P2039",
      meta: { driverAdapterError: { cause: { originalCode: code, code } } },
    });
  it("invalid text for Postgres (NUL, bad escape, bad json) is a 400, not a 500", () => {
    for (const code of ["22021", "22P05", "22P02"]) expect(run(pgError(code)).status, code).toBe(400);
  });
  it("other database errors stay 500 with no detail", () => {
    const r = run(pgError("57P01"));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain("57P01");
  });
});

describe("prisma.config.ts (D-api-12)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("throws without DATABASE_URL instead of silently using cq_dev", async () => {
    vi.stubEnv("DATABASE_URL", "");
    await expect(import("../../prisma.config.js")).rejects.toThrow(/DATABASE_URL/);
  });
  it("uses DATABASE_URL when set", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://u:p@db:5432/x");
    const cfg = (await import("../../prisma.config.js")).default as { datasource?: { url?: string } };
    expect(cfg.datasource?.url).toBe("postgresql://u:p@db:5432/x");
  });
});
