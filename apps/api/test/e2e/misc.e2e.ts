import request from "supertest";
import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BANK, qid } from "@cq/content";
import { makeApp, type TestApp } from "./helpers.js";

describe("health, questions, cors", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await makeApp();
  });
  afterAll(async () => {
    await t.close();
  });
  const http = () => request(t.app.getHttpServer());

  it("GET /v1/health -> {ok:true, db:true}", async () => {
    const r = await http().get("/v1/health").expect(200);
    expect(r.body).toEqual({ ok: true, db: true });
  });

  it("health is 200 with db:false when Postgres is unreachable", async () => {
    const dead = await makeApp({ env: { DATABASE_URL: "postgresql://cq:cq@127.0.0.1:1/nope" } });
    try {
      const r = await request(dead.app.getHttpServer()).get("/v1/health").expect(200);
      expect(r.body).toEqual({ ok: true, db: false });
    } finally {
      await dead.close();
    }
  });

  it("GET /v1/questions returns the bank and rule data with an ETag; If-None-Match -> 304", async () => {
    const r = await http().get("/v1/questions").expect(200);
    expect(r.body.questions).toHaveLength(BANK.length);
    expect(Object.keys(r.body).sort()).toEqual(["pron", "questions", "rules", "tagNames", "tags", "topics"]);
    const etag = r.headers.etag as string;
    expect(etag).toMatch(/^"/);
    const again = await http().get("/v1/questions").set("If-None-Match", etag).expect(304);
    expect(again.text).toBe("");
    await http().get("/v1/questions").set("If-None-Match", '"other"').expect(200);
  });

  it("CORS: only WEB_ORIGIN, with credentials", async () => {
    const ok = await http().options("/v1/progress").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "PUT");
    expect(ok.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(ok.headers["access-control-allow-credentials"]).toBe("true");
    const bad = await http().get("/v1/health").set("Origin", "https://evil.example");
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("CORS exposes Retry-After and still answers when the body parser rejects (cors before parsers)", async () => {
    const pre = await http().options("/v1/progress").set("Origin", "http://localhost:3000").set("Access-Control-Request-Method", "PUT");
    expect(pre.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    const r = await http()
      .post("/v1/coach/round")
      .set("Origin", "http://localhost:3000")
      .set("Content-Type", "application/json")
      .send("{nope")
      .expect(400);
    expect(r.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    expect(String(r.headers["access-control-expose-headers"])).toContain("Retry-After");
  });

  it("unknown route -> 404 json without stack", async () => {
    const r = await http().get("/v1/nope").expect(404);
    expect(JSON.stringify(r.body)).not.toMatch(/node_modules|\.ts:/);
  });
});

describe("coach over HTTP", () => {
  const goodRows = [
    { s: "Paul coupe ___ pain frais.", a: "du", o: ["du", "de la", "de l'", "des"], tag: "m", en: "x" },
    { s: "Nous prenons ___ salade verte.", a: "de la", o: ["du", "de la", "de l'", "des"], tag: "f", en: "x" },
    { s: "Tu achetes ___ pommes rouges.", a: "des", o: ["du", "de la", "de l'", "des"], tag: "p", en: "x" },
    { s: "Elle veut ___ eau fraiche.", a: "de l'", o: ["du", "de la", "de l'", "des"], tag: "v", en: "x" },
  ];

  it("round: valid questions come back", async () => {
    const t = await makeApp({
      env: { ANTHROPIC_API_KEY: "sk-ant-secret-key" },
      coachClient: { complete: async () => JSON.stringify(goodRows) },
    });
    try {
      const r = await request(t.app.getHttpServer()).post("/v1/coach/round").send({ n: 8 }).expect(200);
      expect(r.body.fallback).toBe(false);
      expect(r.body.questions).toHaveLength(4);
      expect(r.body.questions[0]).toMatchObject({ _ai: true, t: 6, tier: 3, k: "choice" });
    } finally {
      await t.close();
    }
  });

  it("a client error that contains the key reaches neither the response nor the logs", async () => {
    const KEY = "sk-ant-api03-SUPERSECRET";
    const lines: string[] = [];
    const sink = (...a: unknown[]) => void lines.push(a.map(String).join(" "));
    const t = await makeApp({
      env: { ANTHROPIC_API_KEY: KEY },
      coachClient: {
        complete: async () => {
          throw Object.assign(new Error(`401 invalid x-api-key ${KEY}`), { status: 500, headers: { "x-api-key": KEY } });
        },
      },
    });
    // after makeApp: compiling a testing module installs its own (silent) logger
    Logger.overrideLogger({ log: sink, error: sink, warn: sink, debug: sink, verbose: sink, fatal: sink });
    try {
      const bodies = [
        await request(t.app.getHttpServer()).post("/v1/coach/round").send({}),
        await request(t.app.getHttpServer()).post("/v1/coach/explain").send({ qid: qid(BANK[0]!), gave: "x" }),
      ];
      for (const r of bodies) {
        expect(r.status).toBe(200);
        expect(JSON.stringify([r.body, r.headers, r.text])).not.toContain("SUPERSECRET");
      }
      expect(lines.length).toBeGreaterThan(0); // the failure was logged...
      expect(lines.join("\n")).not.toContain("SUPERSECRET"); // ...without the key
    } finally {
      Logger.overrideLogger(["error", "warn", "log"]);
      await t.close();
    }
  });

  it("round without a key: fallback no_key", async () => {
    const t = await makeApp({ coachClient: null });
    try {
      const r = await request(t.app.getHttpServer()).post("/v1/coach/round").send({}).expect(200);
      expect(r.body).toEqual({ fallback: true, reason: "no_key" });
    } finally {
      await t.close();
    }
  });

  it("round with a real (keyless) env builds no client and makes no network call", async () => {
    const t = await makeApp({ env: { ANTHROPIC_API_KEY: "" } });
    try {
      const r = await request(t.app.getHttpServer()).post("/v1/coach/round").send({}).expect(200);
      expect(r.body).toEqual({ fallback: true, reason: "no_key" });
    } finally {
      await t.close();
    }
  });

  it("round: body validation -> 400 with issues", async () => {
    const t = await makeApp({ coachClient: null });
    try {
      const r = await request(t.app.getHttpServer()).post("/v1/coach/round").send({ n: 99 }).expect(400);
      expect(r.body.issues).toBeInstanceOf(Array);
    } finally {
      await t.close();
    }
  });

  it("explain: returns short text", async () => {
    const q = BANK.find((x) => x.k === "type")!;
    const t = await makeApp({ coachClient: { complete: async () => "Line one.\nLine two." } });
    try {
      const r = await request(t.app.getHttpServer()).post("/v1/coach/explain").send({ qid: qid(q), gave: "du" }).expect(200);
      expect(r.body).toEqual({ fallback: false, text: "Line one.\nLine two." });
    } finally {
      await t.close();
    }
  });

  it("rate limit: per known device, shared by round and explain, then 429 with Retry-After", async () => {
    const t = await makeApp({ coachClient: null, coach: { rateLimit: { limit: 3, windowMs: 60_000 } } });
    try {
      const a = request.agent(t.app.getHttpServer());
      await a.get("/v1/progress").expect(200); // establishes the device
      await a.post("/v1/coach/round").send({}).expect(200);
      await a.post("/v1/coach/explain").send({ qid: "x", gave: "y" }).expect(200);
      await a.post("/v1/coach/round").send({}).expect(200);
      const limited = await a.post("/v1/coach/round").send({}).expect(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    } finally {
      await t.close();
    }
  });

  it("1000 cookieless calls cannot exceed the limit and create no users", async () => {
    const t = await makeApp({ coachClient: null, coach: { rateLimit: { limit: 5, windowMs: 60_000 } } });
    try {
      const before = await t.prisma.user.count();
      let ok = 0;
      for (let i = 0; i < 1000; i += 50) {
        const rs = await Promise.all(
          Array.from({ length: 50 }, () => request(t.app.getHttpServer()).post("/v1/coach/round").send({})),
        );
        ok += rs.filter((r) => r.status === 200).length;
        for (const r of rs) expect(r.headers["set-cookie"]).toBeUndefined();
      }
      expect(ok).toBe(5);
      expect(await t.prisma.user.count()).toBe(before);
    } finally {
      await t.close();
    }
  });

  it("a global per-minute ceiling holds across devices (COACH_GLOBAL_PER_MIN)", async () => {
    const t = await makeApp({ coachClient: null, env: { COACH_GLOBAL_PER_MIN: "4" }, coach: { rateLimit: { limit: 100, windowMs: 60_000 } } });
    try {
      const codes: number[] = [];
      for (let i = 0; i < 7; i++) {
        const a = request.agent(t.app.getHttpServer());
        await a.get("/v1/progress");
        codes.push((await a.post("/v1/coach/round").send({})).status);
      }
      expect(codes.filter((c) => c === 200)).toHaveLength(4);
      expect(codes.filter((c) => c === 429)).toHaveLength(3);
    } finally {
      await t.close();
    }
  });

  it("client IP keys the limiter; X-Forwarded-For counts only with TRUST_PROXY_HOPS > 0", async () => {
    const lim = { rateLimit: { limit: 2, windowMs: 60_000 } };
    const direct = await makeApp({ coachClient: null, coach: lim });
    const proxied = await makeApp({ coachClient: null, env: { TRUST_PROXY_HOPS: "1" }, coach: lim });
    try {
      const run = async (t: TestApp) => {
        const codes: number[] = [];
        for (let i = 0; i < 4; i++)
          codes.push((await request(t.app.getHttpServer()).post("/v1/coach/round").set("X-Forwarded-For", `9.9.9.${i}`).send({})).status);
        return codes;
      };
      expect(await run(direct)).toEqual([200, 200, 429, 429]); // spoofed header ignored
      expect(await run(proxied)).toEqual([200, 200, 200, 200]); // each forwarded client has its own bucket
    } finally {
      await direct.close();
      await proxied.close();
    }
  });
});
