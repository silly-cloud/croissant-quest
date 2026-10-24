import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVICE_COOKIE } from "@cq/shared";
import { makeApp, type TestApp } from "./helpers.js";

let t: TestApp;
const server = () => t.app.getHttpServer();
const agent = () => request.agent(server());

beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

const save = (a: ReturnType<typeof agent>, version: number | string | undefined, state: object) => {
  const r = a.put("/v1/progress").send({ state });
  return version === undefined ? r : r.set("If-Match", String(version));
};

describe("device cookie", () => {
  it("first request creates a user and sets an httpOnly, SameSite=Lax cookie; the next one reuses it", async () => {
    const a = agent();
    const before = await t.prisma.user.count();
    const r1 = await a.get("/v1/progress").expect(200);
    const cookie = String(r1.headers["set-cookie"]);
    expect(cookie).toContain(`${DEVICE_COOKIE}=`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).not.toMatch(/Secure/i);
    expect(await t.prisma.user.count()).toBe(before + 1);

    const r2 = await a.get("/v1/progress").expect(200);
    expect(r2.headers["set-cookie"]).toBeUndefined();
    expect(await t.prisma.user.count()).toBe(before + 1);
  });

  it("token is 32 random bytes and the cookie is Secure in production", async () => {
    const prod = await makeApp({ env: { NODE_ENV: "production" } });
    try {
      const r = await request(prod.app.getHttpServer()).get("/v1/progress").expect(200);
      const c = String(r.headers["set-cookie"]);
      expect(c).toMatch(/Secure/i);
      const token = /cq_device=([^;]+)/.exec(c)![1]!;
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    } finally {
      await prod.close();
    }
  });

  it("an unknown cookie value is replaced, not trusted", async () => {
    const r = await request(server()).get("/v1/progress").set("Cookie", `${DEVICE_COOKIE}=forged`).expect(200);
    const c = String(r.headers["set-cookie"]);
    expect(c).not.toContain("forged");
    expect(await t.prisma.user.findUnique({ where: { deviceToken: "forged" } })).toBeNull();
  });
});

describe("progress", () => {
  it("GET with nothing saved: empty state, version 0", async () => {
    const r = await agent().get("/v1/progress").expect(200);
    expect(r.body.version).toBe(0);
    expect(r.body.state).toMatchObject({ xp: 0, cro: 0, rounds: 0, log: [] });
  });

  it("create, read, update", async () => {
    const a = agent();
    const p1 = await save(a, 0, { xp: 40, cro: 2, rounds: 1, ts: 100 }).expect(200);
    expect(p1.body.version).toBe(1);
    expect(p1.body.state.xp).toBe(40);

    const g = await a.get("/v1/progress").expect(200);
    expect(g.body).toEqual(p1.body);

    const p2 = await save(a, 1, { xp: 70, cro: 3, rounds: 2, ts: 200 }).expect(200);
    expect(p2.body.version).toBe(2);
    expect(p2.body.state).toMatchObject({ xp: 70, cro: 3, rounds: 2 });

    const row = await t.prisma.progress.findFirstOrThrow({ where: { version: 2, xp: 70 } });
    expect(row.ts).toBe(200n);
  });

  it("stores xp and streak columns", async () => {
    const a = agent();
    await save(a, 0, { xp: 123, streak: 4, ts: 5 }).expect(200);
    const row = await t.prisma.progress.findFirstOrThrow({ where: { xp: 123 } });
    expect(row.streak).toBe(4);
  });

  it("missing If-Match -> 428", async () => {
    const r = await save(agent(), undefined, { xp: 1 }).expect(428);
    expect(r.body.message).toMatch(/If-Match/);
  });

  it("garbage If-Match -> 400", async () => {
    await save(agent(), "abc", { xp: 1 }).expect(400);
  });

  it("accepts quoted and weak If-Match forms", async () => {
    const a = agent();
    await save(a, '"0"', { xp: 1, ts: 1 }).expect(200);
    await save(a, 'W/"1"', { xp: 2, ts: 2 }).expect(200);
  });

  it("stale If-Match -> 409 with the server copy and its version", async () => {
    const a = agent();
    await save(a, 0, { xp: 50, ts: 10 }).expect(200);
    const r = await save(a, 0, { xp: 5, ts: 5 }).expect(409);
    expect(r.body.version).toBe(1);
    expect(r.body.state.xp).toBe(50);
    // nothing was written by the rejected request
    expect((await a.get("/v1/progress")).body.version).toBe(1);
  });

  it("If-Match ahead of the server also conflicts", async () => {
    const a = agent();
    const r = await save(a, 7, { xp: 5 }).expect(409);
    expect(r.body.version).toBe(0);
  });

  it("two parallel PUTs with the same If-Match: exactly one 200 and one 409", async () => {
    const a = agent();
    await save(a, 0, { xp: 1, ts: 1 }).expect(200);
    const [x, y] = await Promise.all([
      save(a, 1, { xp: 10, ts: 10 }),
      save(a, 1, { xp: 20, ts: 20 }),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    const final = await a.get("/v1/progress").expect(200);
    expect(final.body.version).toBe(2);
  });

  it("many parallel PUTs on a brand-new row: exactly one wins", async () => {
    const a = agent();
    await a.get("/v1/progress"); // establish the device first
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => save(a, 0, { xp: i + 1, ts: i + 1 })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect((await a.get("/v1/progress")).body.version).toBe(1);
  });

  it("a stale client that retries with the 409 copy never lowers a counter", async () => {
    const a = agent();
    // tab B has played more
    await save(a, 0, { xp: 200, cro: 5, rounds: 9, crowns: { "6": 3 }, seen: { q1: 3 }, hist: { m: [8, 1] }, ts: 900 }).expect(200);
    // tab A is stale: lower counters, older ts, different wrong/feel
    const stale = { xp: 30, cro: 1, rounds: 2, crowns: { "6": 1 }, seen: { q1: 1, q2: 1 }, hist: { m: [2, 0] }, wrong: { x: 1 }, feel: 10, ts: 100 };
    const conflict = await save(a, 0, stale).expect(409);
    expect(conflict.body.state.xp).toBe(200);
    // client merges and retries at the server's version
    const ok = await save(a, conflict.body.version, stale).expect(200);
    const s = ok.body.state;
    expect(s.xp).toBe(200);
    expect(s.cro).toBe(5);
    expect(s.rounds).toBe(9);
    expect(s.crowns["6"]).toBe(3);
    expect(s.seen).toMatchObject({ q1: 3, q2: 1 });
    expect(s.hist.m).toEqual([8, 1]);
    expect(s.ts).toBe(900);
    expect(s.feel).toBeNull(); // wrong/feel/calib follow the newer ts (the server copy)
    expect(s.wrong).toEqual({}); // and a mistake for a question the bank does not have is dropped anyway
  });

  it("wrong/log/feel follow the newer ts when the client is newer", async () => {
    const a = agent();
    await save(a, 0, { xp: 10, feel: 20, ts: 100 }).expect(200);
    const r = await save(a, 1, { xp: 5, feel: 80, calib: "harder", ts: 300 }).expect(200);
    expect(r.body.state).toMatchObject({ xp: 10, feel: 80, calib: "harder", ts: 300 });
  });

  it("truncates log to 120 and feelLog to 20 on the stored copy", async () => {
    const a = agent();
    const log = Array.from({ length: 150 }, (_, i) => ({ q: `q${i}`, t: 6, tag: "m", gave: "du", at: i }));
    const feelLog = Array.from({ length: 30 }, (_, i) => ({ feel: i, mine: i }));
    const r = await save(a, 0, { log, feelLog, ts: 1 }).expect(200);
    expect(r.body.state.log).toHaveLength(120);
    expect(r.body.state.log[0].q).toBe("q30");
    expect(r.body.state.feelLog).toHaveLength(20);
    const g = await a.get("/v1/progress").expect(200);
    expect(g.body.state.log).toHaveLength(120);
  });

  it("hostile bodies are normalised: __proto__, wrong types", async () => {
    const a = agent();
    const r = await a
      .put("/v1/progress")
      .set("If-Match", "0")
      .set("Content-Type", "application/json")
      .send('{"state":{"xp":"12","crowns":{"__proto__":{"x":1},"6":2},"log":"nope","extra":1}}')
      .expect(200);
    expect(r.body.state.xp).toBe(12);
    expect(r.body.state.log).toEqual([]);
    expect(r.body.state.extra).toBeUndefined();
    expect(({} as Record<string, unknown>).x).toBeUndefined();
  });

  it("a different device cookie sees its own empty progress", async () => {
    const a = agent(), b = agent();
    await save(a, 0, { xp: 999, ts: 1 }).expect(200);
    const rb = await b.get("/v1/progress").expect(200);
    expect(rb.body.version).toBe(0);
    expect(rb.body.state.xp).toBe(0);
    // and B's save does not touch A
    await save(b, 0, { xp: 1, ts: 1 }).expect(200);
    expect((await a.get("/v1/progress")).body.state.xp).toBe(999);
  });

  it("validation: state must be an object -> 400 with issues and no stack", async () => {
    const r = await agent().put("/v1/progress").set("If-Match", "0").send({ state: 5 }).expect(400);
    expect(r.body.issues).toBeInstanceOf(Array);
    expect(JSON.stringify(r.body)).not.toMatch(/\bat .*\.ts|node_modules/);
  });

  it("malformed JSON -> 400, oversized -> 413, both plain", async () => {
    const a = agent();
    const bad = await a.put("/v1/progress").set("If-Match", "0").set("Content-Type", "application/json").send("{nope").expect(400);
    expect(bad.body.statusCode).toBe(400);
    const big = await a.put("/v1/progress").set("If-Match", "0").send({ state: { pad: "x".repeat(300_000) } }).expect(413);
    expect(big.body.statusCode).toBe(413);
  });
});
