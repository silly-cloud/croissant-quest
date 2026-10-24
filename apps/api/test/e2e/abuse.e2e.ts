import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { BANK, qid } from "@cq/content";
import { DEVICE_COOKIE } from "@cq/shared";
import type { CoachClient } from "../../src/modules/coach/coach.client.js";
import { makeApp, type TestApp } from "./helpers.js";

/** Env values that restore the production defaults (empty = unset) for the limits the helper relaxes. */
const DEFAULTS = { DEVICE_CREATE_PER_IP_PER_HOUR: "", COACH_IP_PER_MIN: "", COACH_DEVICE_PER_DAY: "", COACH_GLOBAL_PER_DAY: "" };
const WEB = "http://localhost:3000";

/** A fake model that counts its calls and always answers with text (explain) or nothing useful (round). */
function counter(): CoachClient & { calls: number } {
  const c = { calls: 0, complete: async () => { c.calls++; return "Short reason."; } };
  return c;
}

let apps: TestApp[] = [];
const app = async (o: Parameters<typeof makeApp>[0] = {}) => {
  const t = await makeApp(o);
  apps.push(t);
  return t;
};
afterEach(async () => {
  for (const t of apps) await t.close();
  apps = [];
});

const device = async (t: TestApp, xff?: string) => {
  const a = request.agent(t.app.getHttpServer());
  const g = a.get("/v1/progress");
  await (xff ? g.set("X-Forwarded-For", xff) : g).expect(200);
  return a;
};
const explain = { qid: qid(BANK[0]!), gave: "du" };

describe("coach requires an established device", () => {
  it("no cookie or an unknown cookie -> 401 no_device, no upstream call, no user", async () => {
    const fake = counter();
    const t = await app({ coachClient: fake });
    const before = await t.prisma.user.count();
    for (const path of ["/v1/coach/round", "/v1/coach/explain"]) {
      const r = await request(t.app.getHttpServer()).post(path).send(explain).expect(401);
      expect(r.body.error).toBe("no_device");
      await request(t.app.getHttpServer()).post(path).set("Cookie", `${DEVICE_COOKIE}=forged`).send(explain).expect(401);
    }
    expect(fake.calls).toBe(0);
    expect(await t.prisma.user.count()).toBe(before);
  });

  it("a cookie with %00 or other junk is treated as no cookie (401 / new device), never 500", async () => {
    const t = await app({ coachClient: null });
    for (const junk of ["%00", "a%00b", "%FF", "x".repeat(43) + "%00", "%C0%80", "a b"]) {
      const c = `${DEVICE_COOKIE}=${junk}`;
      await request(t.app.getHttpServer()).post("/v1/coach/round").set("Cookie", c).send({}).expect(401);
      await request(t.app.getHttpServer()).put("/v1/progress").set("Cookie", c).set("If-Match", "0").send({ state: {} }).expect(401);
      const g = await request(t.app.getHttpServer()).get("/v1/progress").set("Cookie", c).expect(200);
      expect(String(g.headers["set-cookie"])).toMatch(new RegExp(`${DEVICE_COOKIE}=[A-Za-z0-9_-]{43};`));
    }
  });
});

describe("coach quotas cannot be reset by minting cookies", () => {
  it("14 minted cookies from one IP cannot exceed COACH_IP_PER_MIN (default 20)", async () => {
    const fake = counter();
    const t = await app({ coachClient: fake, env: DEFAULTS });
    const agents = [];
    for (let i = 0; i < 14; i++) agents.push(await device(t));
    const rs = await Promise.all(agents.flatMap((a) => Array.from({ length: 10 }, () => a.post("/v1/coach/explain").send(explain))));
    const codes = rs.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(20);
    expect(codes.filter((c) => c === 429)).toHaveLength(120);
    expect(fake.calls).toBe(20);
    expect(Number(rs.find((r) => r.status === 429)!.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("per-device minute limit (10) still holds for a single cookie", async () => {
    const t = await app({ coachClient: null, env: DEFAULTS });
    const a = await device(t);
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await a.post("/v1/coach/round").send({})).status);
    expect(codes).toEqual([...Array(10).fill(200), 429, 429]);
  });

  it("per-device daily quota (COACH_DEVICE_PER_DAY)", async () => {
    const t = await app({ coachClient: null, env: { COACH_DEVICE_PER_DAY: "3" }, coach: { rateLimit: { limit: 100, windowMs: 60_000 } } });
    const a = await device(t);
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await a.post("/v1/coach/round").send({})).status);
    expect(codes).toEqual([200, 200, 200, 429, 429]);
    const other = await device(t);
    await other.post("/v1/coach/round").send({}).expect(200); // another device is not affected
  });

  it("the IP limit is per client IP behind a trusted proxy", async () => {
    const t = await app({ coachClient: null, env: { COACH_IP_PER_MIN: "2", TRUST_PROXY_HOPS: "1" } });
    const codes = async (ip: string) => {
      const out: number[] = [];
      for (let i = 0; i < 3; i++) out.push((await (await device(t, ip)).post("/v1/coach/round").set("X-Forwarded-For", ip).send({})).status);
      return out;
    };
    expect(await codes("9.9.9.1")).toEqual([200, 200, 429]);
    expect(await codes("9.9.9.2")).toEqual([200, 200, 429]);
  });

  it("global daily budget (COACH_GLOBAL_PER_DAY) holds across IPs and devices", async () => {
    const t = await app({ coachClient: null, env: { COACH_GLOBAL_PER_DAY: "4", TRUST_PROXY_HOPS: "1" } });
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const ip = `7.7.7.${i}`;
      codes.push((await (await device(t, ip)).post("/v1/coach/round").set("X-Forwarded-For", ip).send({})).status);
    }
    expect(codes).toEqual([200, 200, 200, 200, 429, 429]);
  });

  it("a refused call does not spend another quota (device blocked -> IP budget untouched)", async () => {
    const t = await app({ coachClient: null, env: { COACH_IP_PER_MIN: "3" }, coach: { rateLimit: { limit: 1, windowMs: 60_000 } } });
    const a = await device(t);
    await a.post("/v1/coach/round").send({}).expect(200);
    for (let i = 0; i < 5; i++) await a.post("/v1/coach/round").send({}).expect(429);
    const b = await device(t);
    await b.post("/v1/coach/round").send({}).expect(200);
    const c = await device(t);
    await c.post("/v1/coach/round").send({}).expect(200);
    const d = await device(t);
    await d.post("/v1/coach/round").send({}).expect(429); // 3 per IP spent by a, b, c
  });
});

describe("device creation is rate-limited per IP", () => {
  it("beyond DEVICE_CREATE_PER_IP_PER_HOUR (default 20) -> 429 with Retry-After and no User row", async () => {
    const t = await app({ env: DEFAULTS });
    const before = await t.prisma.user.count();
    for (let i = 0; i < 20; i++) await request(t.app.getHttpServer()).get("/v1/progress").expect(200);
    const r = await request(t.app.getHttpServer()).get("/v1/progress").expect(429);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    expect(r.headers["set-cookie"]).toBeUndefined();
    expect(await t.prisma.user.count()).toBe(before + 20);
  });

  it("an existing device keeps working after its IP hit the creation limit", async () => {
    const t = await app({ env: { DEVICE_CREATE_PER_IP_PER_HOUR: "1" } });
    const a = await device(t);
    await request(t.app.getHttpServer()).get("/v1/progress").expect(429);
    await a.get("/v1/progress").expect(200);
    await a.put("/v1/progress").set("If-Match", "0").send({ state: { xp: 1 } }).expect(200);
  });
});

describe("same-origin and JSON-only on state-changing routes", () => {
  it("a cross-site text/plain POST is refused and makes no upstream call", async () => {
    const fake = counter();
    const t = await app({ coachClient: fake });
    const a = await device(t);
    for (const path of ["/v1/coach/round", "/v1/coach/explain"]) {
      const cross = await a.post(path).set("Origin", "https://evil.example").set("Content-Type", "text/plain").send(JSON.stringify(explain));
      expect(cross.status).toBe(403);
      expect(cross.body.error).toBe("bad_origin");
      // same origin but text/plain (the no-preflight "simple request" shape) -> 415
      await a.post(path).set("Origin", WEB).set("Content-Type", "text/plain").send(JSON.stringify(explain)).expect(415);
      // form posts too
      await a.post(path).type("form").send({ x: 1 }).expect(415);
    }
    expect(fake.calls).toBe(0);
    await a.post("/v1/coach/explain").set("Origin", WEB).send(explain).expect(200);
    expect(fake.calls).toBe(1);
  });

  it("PUT /v1/progress: bad Origin -> 403, bad Referer -> 403, non-JSON -> 415, nothing saved", async () => {
    const t = await app();
    const a = await device(t);
    await a.put("/v1/progress").set("Origin", "https://evil.example").set("If-Match", "0").send({ state: { xp: 5 } }).expect(403);
    await a.put("/v1/progress").set("Origin", "null").set("If-Match", "0").send({ state: { xp: 5 } }).expect(403);
    await a.put("/v1/progress").set("Referer", "https://evil.example/page").set("If-Match", "0").send({ state: { xp: 5 } }).expect(403);
    await a.put("/v1/progress").set("Referer", "not a url").set("If-Match", "0").send({ state: { xp: 5 } }).expect(403);
    await a.put("/v1/progress").set("If-Match", "0").set("Content-Type", "text/plain").send('{"state":{"xp":5}}').expect(415);
    expect((await a.get("/v1/progress")).body.version).toBe(0);
    await a.put("/v1/progress").set("Referer", `${WEB}/play`).set("If-Match", "0").send({ state: { xp: 5 } }).expect(200);
    await a.put("/v1/progress").set("Origin", WEB).set("If-Match", "1").send({ state: { xp: 6 } }).expect(200);
    // no Origin and no Referer (server-to-server, tests) is allowed
    await a.put("/v1/progress").set("If-Match", "2").send({ state: { xp: 7 } }).expect(200);
  });

  it("GET routes need neither (no Content-Type, any origin)", async () => {
    const t = await app();
    await request(t.app.getHttpServer()).get("/v1/progress").set("Origin", "https://evil.example").expect(200);
    await request(t.app.getHttpServer()).get("/v1/questions").set("Origin", "https://evil.example").expect(200);
  });
});

describe("last is checked against the server clock", () => {
  const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  it.each([
    ["9999-12-31", null],
    ["~", null],
    ["2026-02-30", null],
    ["tomorrow+2", null],
  ])("rejects last=%s", async (label) => {
    const t = await app();
    const a = await device(t);
    const last = label === "tomorrow+2" ? day(3) : label;
    const r = await a.put("/v1/progress").set("If-Match", "0").send({ state: { streak: 50, last } }).expect(200);
    expect(r.body.state.last).toBeNull();
    expect(r.body.state.streak).toBe(0);
  });

  it("rejects a 200k-char last", async () => {
    const t = await app();
    const a = await device(t);
    const r = await a.put("/v1/progress").set("If-Match", "0").send({ state: { streak: 5, last: "z".repeat(200_000) } }).expect(200);
    expect(r.body.state.last).toBeNull();
  });

  it("accepts today and tomorrow (UTC+14), keeps the server's pair over a rejected future one", async () => {
    const t = await app();
    const a = await device(t);
    await a.put("/v1/progress").set("If-Match", "0").send({ state: { streak: 3, last: day(1) } }).expect(200);
    const r = await a.put("/v1/progress").set("If-Match", "1").send({ state: { streak: 99, last: "9999-12-31" } }).expect(200);
    expect([r.body.state.last, r.body.state.streak]).toEqual([day(1), 3]);
    const b = await device(t);
    const rb = await b.put("/v1/progress").set("If-Match", "0").send({ state: { streak: 2, last: day(0) } }).expect(200);
    expect([rb.body.state.last, rb.body.state.streak]).toEqual([day(0), 2]);
  });
});

describe("ill-formed strings and storage errors", () => {
  it("an emoji cut at 60 UTF-16 units in log.gave saves (200, not 500)", async () => {
    const t = await app();
    const a = await device(t);
    const cut = ("a".repeat(59) + "🥐").slice(0, 60);
    const r = await a
      .put("/v1/progress")
      .set("If-Match", "0")
      .send({ state: { log: [{ q: qid(BANK[0]!), t: 6, tag: "m", gave: cut, at: 1 }] } })
      .expect(200);
    expect(r.body.state.log[0].gave).toBe("a".repeat(59) + "�");
  });

  it("NUL in state strings saves (200) with the NUL removed", async () => {
    const t = await app();
    const a = await device(t);
    const r = await a
      .put("/v1/progress")
      .set("If-Match", "0")
      .send({ state: { log: [{ q: "x\u0000y", t: 6, tag: "m\u0000", gave: "d\u0000u", at: 1 }], last: "2026-10-24\u0000" } })
      .expect(200);
    expect(r.body.state.log[0]).toMatchObject({ q: "xy", tag: "m", gave: "du" });
    expect(r.body.state.last).toBeNull();
  });
});

describe("headers and parser errors", () => {
  it("no X-Powered-By, no Express ETag on /v1/progress, Vary: Origin even for a disallowed origin", async () => {
    const t = await app();
    const g = await request(t.app.getHttpServer()).get("/v1/progress").expect(200);
    expect(g.headers["x-powered-by"]).toBeUndefined();
    expect(g.headers.etag).toBeUndefined();
    const q = await request(t.app.getHttpServer()).get("/v1/questions").set("Origin", "https://evil.example").expect(200);
    expect(q.headers["access-control-allow-origin"]).toBeUndefined();
    expect(String(q.headers.vary)).toMatch(/Origin/i);
    expect(q.headers.etag).toMatch(/^"/); // questions keeps its own strong ETag
    const ok = await request(t.app.getHttpServer()).get("/v1/questions").set("Origin", WEB).expect(200);
    expect(String(ok.headers.vary)).toMatch(/Origin/i);
  });

  it("malformed JSON -> 400 that does not echo the body", async () => {
    const t = await app();
    const a = await device(t);
    for (const body of ['{"state":{SECRETFRAGMENT', '"strSECRETFRAGMENT"']) {
      const r = await a.put("/v1/progress").set("If-Match", "0").set("Content-Type", "application/json").send(body).expect(400);
      expect(r.body).toEqual({ statusCode: 400, error: "Malformed request body", message: "Malformed request body" });
      expect(r.text).not.toContain("SECRETFRAGMENT");
      expect(r.text).not.toMatch(/position|JSON/);
    }
  });

  it("a bad gzip body -> 400, not 500", async () => {
    const t = await app();
    const a = await device(t);
    const r = await a
      .put("/v1/progress")
      .set("If-Match", "0")
      .set("Content-Type", "application/json")
      .set("Content-Encoding", "gzip")
      .send("this is not gzip");
    expect(r.status).toBe(400);
    expect(r.body.statusCode).toBe(400);
  });
});
