// A tiny stand-in for apps/api, written against the contract in packages/shared/src/contract.ts.
// Versioned progress with If-Match (409 returns the server copy), the question bank, a scriptable coach,
// and /__fake/* controls for the tests. Run: node e2e/fake-api.mjs [port]
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bank = JSON.parse(fs.readFileSync(path.resolve(here, "../../../packages/content/data/bank.json"), "utf8"));
const port = Number(process.argv[2] ?? process.env.FAKE_API_PORT ?? 3101);

const fresh = () => ({ version: 0, state: {}, cookie: false, down: false, coach: "fallback", calls: [] });
let S = fresh();

const send = (res, status, data) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
};
const readBody = (req) =>
  new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : undefined);
      } catch {
        resolve(undefined);
      }
    });
  });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const p = url.pathname;
  const method = req.method ?? "GET";
  const body = await readBody(req);

  if (p === "/__fake/reset") {
    S = fresh();
    return send(res, 200, { ok: true });
  }
  if (p === "/__fake/set") {
    Object.assign(S, body);
    return send(res, 200, { ok: true });
  }
  if (p === "/__fake/state") return send(res, 200, S);

  S.calls.push({ method, path: p, ifMatch: req.headers["if-match"] ?? null });
  if (S.down) return send(res, 503, { message: "down" });

  if (p === "/v1/health") return send(res, 200, { ok: true, db: true });
  if (p === "/v1/questions") return send(res, 200, bank);
  if (p === "/v1/progress" && method === "GET" && (S.cookie = true)) return send(res, 200, { state: S.state, version: S.version });
  if (p === "/v1/progress" && method === "PUT") {
    if (!S.cookie) return send(res, 401, { error: "no_device" }); // only GET creates the device
    if (req.headers["if-match"] !== String(S.version)) return send(res, 409, { state: S.state, version: S.version });
    S.state = body?.state ?? {};
    S.version += 1;
    return send(res, 200, { state: S.state, version: S.version });
  }
  if (p === "/v1/coach/round") {
    if (S.coach === "limited") return send(res, 429, { error: "rate_limited" });
    if (S.coach === "hang") return; // never answers
    if (S.coach === "questions") {
      const qs = bank.filter((q) => q.t === 6 && q.k === "choice").slice(20, 28).map((q) => ({ ...q, _ai: true }));
      return send(res, 200, { fallback: false, questions: qs });
    }
    return send(res, 200, { fallback: true, reason: "no_key" });
  }
  if (p === "/v1/coach/explain") return send(res, 200, { fallback: true, reason: "no_key" });
  return send(res, 404, { message: "not found" });
});

server.listen(port, "127.0.0.1", () => console.log(`fake api on http://127.0.0.1:${port}`));
