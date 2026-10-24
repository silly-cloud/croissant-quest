import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BANK, qid } from "@cq/content";
import { DEVICE_COOKIE } from "@cq/shared";

const [Q1, Q2] = [qid(BANK[0]!), qid(BANK[1]!)] as [string, string];
import { makeApp, type TestApp } from "./helpers.js";

let t: TestApp;
const server = () => t.app.getHttpServer();
const agent = () => request.agent(server());
/** A device that has done its GET /v1/progress first (the only call that creates a user). */
const fresh = async () => {
  const a = agent();
  await a.get("/v1/progress").expect(200);
  return a;
};

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

  it("PUT without a valid device cookie -> 401 no_device and creates no user", async () => {
    const before = await t.prisma.user.count();
    const r = await request(server()).put("/v1/progress").set("If-Match", "0").send({ state: { xp: 1 } }).expect(401);
    expect(r.body.error).toBe("no_device");
    await request(server()).put("/v1/progress").set("Cookie", `${DEVICE_COOKIE}=forged`).set("If-Match", "0").send({ state: {} }).expect(401);
    expect(await t.prisma.user.count()).toBe(before);
  });

  it("health, questions and CORS preflight never create users", async () => {
    const before = await t.prisma.user.count();
    await request(server()).get("/v1/health").expect(200);
    await request(server()).get("/v1/questions").expect(200);
    expect(await t.prisma.user.count()).toBe(before);
  });

  it("COOKIE_SECURE overrides the NODE_ENV default", async () => {
    const off = await makeApp({ env: { NODE_ENV: "production", COOKIE_SECURE: "false" } });
    const on = await makeApp({ env: { COOKIE_SECURE: "true" } });
    try {
      expect(String((await request(off.app.getHttpServer()).get("/v1/progress")).headers["set-cookie"])).not.toMatch(/Secure/i);
      expect(String((await request(on.app.getHttpServer()).get("/v1/progress")).headers["set-cookie"])).toMatch(/Secure/i);
    } finally {
      await off.close();
      await on.close();
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
    const a = await fresh();
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
    const a = await fresh();
    await save(a, 0, { xp: 123, streak: 4, ts: 5 }).expect(200);
    const row = await t.prisma.progress.findFirstOrThrow({ where: { xp: 123 } });
    expect(row.streak).toBe(4);
  });

  it("missing If-Match -> 428", async () => {
    const r = await save(await fresh(), undefined, { xp: 1 }).expect(428);
    expect(r.body.message).toMatch(/If-Match/);
  });

  it("garbage If-Match -> 400", async () => {
    await save(await fresh(), "abc", { xp: 1 }).expect(400);
  });

  it("accepts quoted and weak If-Match forms", async () => {
    const a = await fresh();
    await save(a, '"0"', { xp: 1, ts: 1 }).expect(200);
    await save(a, 'W/"1"', { xp: 2, ts: 2 }).expect(200);
  });

  it("stale If-Match -> 409 with the server copy and its version", async () => {
    const a = await fresh();
    await save(a, 0, { xp: 50, ts: 10 }).expect(200);
    const r = await save(a, 0, { xp: 5, ts: 5 }).expect(409);
    expect(r.body.version).toBe(1);
    expect(r.body.state.xp).toBe(50);
    // nothing was written by the rejected request
    expect((await a.get("/v1/progress")).body.version).toBe(1);
  });

  it("If-Match ahead of the server also conflicts", async () => {
    const a = await fresh();
    const r = await save(a, 7, { xp: 5 }).expect(409);
    expect(r.body.version).toBe(0);
  });

  it("two parallel PUTs with the same If-Match: exactly one 200 and one 409", async () => {
    const a = await fresh();
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
    const a = await fresh();
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => save(a, 0, { xp: i + 1, ts: i + 1 })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(7);
    expect((await a.get("/v1/progress")).body.version).toBe(1);
  });

  it("a stale client that retries with the 409 copy never lowers a counter", async () => {
    const a = await fresh();
    // tab B has played more
    await save(a, 0, { xp: 200, cro: 5, rounds: 9, crowns: { "6": 3 }, seen: { [Q1]: 3 }, hist: { m: [8, 1] }, ts: 900 }).expect(200);
    // tab A is stale: lower counters, older ts, different wrong/feel
    const stale = { xp: 30, cro: 1, rounds: 2, crowns: { "6": 1 }, seen: { [Q1]: 1, [Q2]: 1 }, hist: { m: [2, 0] }, wrong: { x: 1 }, feel: 10, ts: 100 };
    const conflict = await save(a, 0, stale).expect(409);
    expect(conflict.body.state.xp).toBe(200);
    // client merges and retries at the server's version
    const ok = await save(a, conflict.body.version, stale).expect(200);
    const s = ok.body.state;
    expect(s.xp).toBe(200);
    expect(s.cro).toBe(5);
    expect(s.rounds).toBe(9);
    expect(s.crowns["6"]).toBe(3);
    expect(s.seen).toMatchObject({ [Q1]: 3, [Q2]: 1 });
    expect(s.hist.m).toEqual([8, 1]);
    expect(s.ts).toBe(900);
    expect(s.feel).toBeNull(); // wrong/feel/calib follow the newer ts (the server copy)
    expect(s.wrong).toEqual({}); // and a mistake for a question the bank does not have is dropped anyway
  });

  it("wrong/log/feel follow the newer ts when the client is newer", async () => {
    const a = await fresh();
    await save(a, 0, { xp: 10, feel: 20, ts: 100 }).expect(200);
    const r = await save(a, 1, { xp: 5, feel: 80, calib: "harder", ts: 300 }).expect(200);
    expect(r.body.state).toMatchObject({ xp: 10, feel: 80, calib: "harder", ts: 300 });
  });

  it("truncates log to 120 and feelLog to 20 on the stored copy", async () => {
    const a = await fresh();
    const log = Array.from({ length: 150 }, (_, i) => ({ q: `q${i}`, t: 6, tag: "m", gave: "du", at: i }));
    const feelLog = Array.from({ length: 30 }, (_, i) => ({ feel: i, mine: i }));
    const r = await save(a, 0, { log, feelLog, ts: 1 }).expect(200);
    expect(r.body.state.log).toHaveLength(120);
    expect(r.body.state.log[0].q).toBe("q30");
    expect(r.body.state.feelLog).toHaveLength(20);
    const g = await a.get("/v1/progress").expect(200);
    expect(g.body.state.log).toHaveLength(120);
  });

  it("ts from the client is clamped to server time + 5 minutes; a missing ts becomes server time", async () => {
    const a = await fresh();
    const r = await save(a, 0, { xp: 1, ts: Number.MAX_SAFE_INTEGER }).expect(200);
    expect(r.body.state.ts).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
    expect(r.body.state.ts).toBeGreaterThan(Date.now() - 60_000);
    const b = await fresh();
    const r2 = await save(b, 0, { xp: 1 }).expect(200);
    expect(r2.body.state.ts).toBeGreaterThan(Date.now() - 60_000);
    // the next honest save still wins newer-ts-wins fields
    const r3 = await save(a, 1, { feel: 40, ts: Date.now() + 10 * 60 * 1000 }).expect(200);
    expect(r3.body.state.ts).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000);
  });

  it("saves are bounded: ~12k random seen keys do not grow the stored row", async () => {
    const a = await fresh();
    const seen: Record<string, number> = {};
    for (let i = 0; i < 12_000; i++) seen[Math.random().toString(36).slice(2, 9) + i] = 1;
    const r = await save(a, 0, { seen, ts: 1 }).expect(200);
    expect(Object.keys(r.body.state.seen)).toHaveLength(0);
  });

  it("xp column matches the clamped state", async () => {
    const a = await fresh();
    const r = await save(a, 0, { xp: 5e12, ts: 1 }).expect(200);
    expect(r.body.state.xp).toBe(1_000_000_000);
    const row = await t.prisma.progress.findFirstOrThrow({ where: { xp: 1_000_000_000 } });
    expect(row.version).toBe(1);
  });

  it("a crowns key like constructor does not poison a merge", async () => {
    const a = await fresh();
    await save(a, 0, { crowns: { constructor: 5 }, ts: 1 }).expect(200);
    const r = await save(a, 1, { crowns: { constructor: 5 }, ts: 2 }).expect(200);
    expect(Object.keys(r.body.state.crowns).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("hostile bodies are normalised: __proto__, wrong types", async () => {
    const a = await fresh();
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
    const a = await fresh(), b = await fresh();
    await save(a, 0, { xp: 999, ts: 1 }).expect(200);
    const rb = await b.get("/v1/progress").expect(200);
    expect(rb.body.version).toBe(0);
    expect(rb.body.state.xp).toBe(0);
    // and B's save does not touch A
    await save(b, 0, { xp: 1, ts: 1 }).expect(200);
    expect((await a.get("/v1/progress")).body.state.xp).toBe(999);
  });

  it("validation: state must be an object -> 400 with issues and no stack", async () => {
    const r = await (await fresh()).put("/v1/progress").set("If-Match", "0").send({ state: 5 }).expect(400);
    expect(r.body.issues).toBeInstanceOf(Array);
    expect(JSON.stringify(r.body)).not.toMatch(/\bat .*\.ts|node_modules/);
  });

  it("malformed JSON -> 400, oversized -> 413, both plain", async () => {
    const a = await fresh();
    const bad = await a.put("/v1/progress").set("If-Match", "0").set("Content-Type", "application/json").send("{nope").expect(400);
    expect(bad.body.statusCode).toBe(400);
    const big = await a.put("/v1/progress").set("If-Match", "0").send({ state: { pad: "x".repeat(300_000) } }).expect(413);
    expect(big.body.statusCode).toBe(413);
  });
});
