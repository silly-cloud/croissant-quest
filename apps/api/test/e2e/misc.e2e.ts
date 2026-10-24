import request from "supertest";
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

  it("round: valid questions come back; the key is never in the response", async () => {
    const t = await makeApp({
      env: { ANTHROPIC_API_KEY: "sk-ant-secret-key" },
      coachClient: { complete: async () => JSON.stringify(goodRows) },
    });
    try {
      const a = request.agent(t.app.getHttpServer());
      const r = await a.post("/v1/coach/round").send({ n: 8 }).expect(200);
      expect(r.body.fallback).toBe(false);
      expect(r.body.questions).toHaveLength(4);
      expect(r.body.questions[0]).toMatchObject({ _ai: true, t: 6, tier: 3, k: "choice" });
      expect(JSON.stringify(r)).not.toContain("sk-ant");
    } finally {
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

  it("rate limit: per device, shared by round and explain, then 429 with Retry-After", async () => {
    const t = await makeApp({
      coachClient: null,
      coach: { rateLimit: { limit: 3, windowMs: 60_000 } },
    });
    try {
      const a = request.agent(t.app.getHttpServer());
      await a.post("/v1/coach/round").send({}).expect(200);
      await a.post("/v1/coach/explain").send({ qid: "x", gave: "y" }).expect(200);
      await a.post("/v1/coach/round").send({}).expect(200);
      const limited = await a.post("/v1/coach/round").send({}).expect(429);
      expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
      // another device is unaffected
      await request.agent(t.app.getHttpServer()).post("/v1/coach/round").send({}).expect(200);
    } finally {
      await t.close();
    }
  });
});
