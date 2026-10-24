import { describe, expect, it } from "vitest";
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
  it("sweeps expired keys at most once per window and evicts past a hard size cap", () => {
    let now = 0;
    const rl = new RateLimiter(1, 1000, () => now, 50);
    for (let i = 0; i < 40; i++) rl.take("k" + i);
    expect(rl.size).toBe(40);
    now = 500; // inside the first window: no sweep
    rl.take("x");
    now = 1001; // all expired; one sweep happens now
    rl.take("y");
    expect(rl.size).toBe(2); // x (live) and y
    for (let i = 0; i < 500; i++) rl.take("flood" + i); // same window: no sweep, but never above the cap
    expect(rl.size).toBeLessThanOrEqual(50);
  });
});

describe("coach config / client", () => {
  it("no key means no client; the model id lives in config only", () => {
    expect(createCoachClient(undefined)).toBeNull();
    expect(createCoachClient("sk-ant-x")).not.toBeNull();
    expect(coachConfig).toMatchObject({ model: "claude-sonnet-5-5", tier: "default", timeoutMs: 30_000, retries: 2 });
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
