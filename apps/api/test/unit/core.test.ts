import { describe, expect, it } from "vitest";
import { z } from "zod";
import { BadRequestException } from "@nestjs/common";
import { loadEnv } from "../../src/env.js";
import { ZodPipe } from "../../src/common/zod.pipe.js";
import { RateLimiter } from "../../src/modules/coach/rate-limit.guard.js";
import { createCoachClient } from "../../src/modules/coach/coach.client.js";
import { coachConfig } from "../../src/modules/coach/coach.config.js";
import { parseIfMatch } from "../../src/modules/progress/progress.controller.js";
import { trimForStorage } from "../../src/modules/progress/progress.service.js";
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
  it("keeps the newest 120 log and 20 feelLog entries", () => {
    const s = normState({
      log: Array.from({ length: 130 }, (_, i) => ({ q: String(i) })),
      feelLog: Array.from({ length: 25 }, (_, i) => ({ feel: i, mine: i })),
    });
    const t = trimForStorage(s);
    expect(t.log).toHaveLength(120);
    expect(t.log[0]).toMatchObject({ q: "10" });
    expect(t.feelLog).toHaveLength(20);
    expect(t.feelLog[0]).toMatchObject({ feel: 5 });
  });
});
