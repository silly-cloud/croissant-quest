import { BANK } from "@cq/content";

/**
 * An in-memory stand-in for apps/api, written against the HTTP contract in @cq/shared:
 * versioned progress with If-Match (409 returns the server copy), questions, and a scriptable coach.
 */
export type CoachMode = "limited" | "fallback" | "questions" | "hang" | "error";

export class FakeApi {
  version = 0;
  state: Record<string, unknown> = {};
  down = false;
  /** only GET /progress creates the device cookie; PUT without it is 401 */
  cookie = false;
  coach: CoachMode = "fallback";
  calls: { method: string; path: string; ifMatch?: string | null; body?: unknown }[] = [];
  /** run once, right before the next PUT is judged (to simulate another tab saving first) */
  beforePut: (() => void) | null = null;

  /** another device saved: version moves on */
  external(state: Record<string, unknown>) {
    this.state = state;
    this.version++;
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const path = String(input).replace(/^https?:\/\/[^/]+/, "");
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    this.calls.push({ method, path, ifMatch: headers.get("if-match"), body });
    if (this.down) throw new TypeError("network down");
    const json = (status: number, data: unknown) =>
      new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

    if (path === "/v1/health") return json(200, { ok: true, db: true });
    if (path === "/v1/questions") return json(200, BANK);
    if (path === "/v1/progress" && method === "GET" && (this.cookie = true)) return json(200, { state: this.state, version: this.version });
    if (path === "/v1/progress" && method === "PUT") {
      if (!this.cookie) return json(401, { error: "no_device" });
      this.beforePut?.();
      this.beforePut = null;
      if (headers.get("if-match") !== String(this.version)) return json(409, { state: this.state, version: this.version });
      this.state = body.state;
      this.version++;
      return json(200, { state: this.state, version: this.version });
    }
    if (path === "/v1/coach/round") {
      if (this.coach === "hang")
        return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
      if (this.coach === "limited") return json(429, { error: "rate_limited" });
      if (this.coach === "error") return json(500, {});
      if (this.coach === "questions") {
        const qs = BANK.filter((q) => q.k === "choice" && q.t === 6)
          .slice(0, 8)
          .map((q) => ({ ...q, _ai: true }));
        return json(200, { fallback: false, questions: qs });
      }
      return json(200, { fallback: true, reason: "no_key" });
    }
    if (path === "/v1/coach/explain") return json(200, { fallback: true, reason: "no_key" });
    return json(404, {});
  };
}
