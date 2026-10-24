import { createServer, request, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.js";
import { localOnly, setupApp } from "../../src/setup-app.js";

const base = { DATABASE_URL: "postgresql://x" };
const cli = { ...base, COACH_PROVIDER: "claude-cli" };

describe("env: COACH_PROVIDER=claude-cli", () => {
  it("is never chosen automatically; anthropic keeps listening as before", () => {
    expect(loadEnv(base)).toMatchObject({
      COACH_PROVIDER: "anthropic",
      HOST: undefined,
      CLAUDE_CLI_PATH: "claude",
    });
    expect(
      loadEnv({ ...base, ANTHROPIC_API_KEY: "sk-ant-x" }).COACH_PROVIDER
    ).toBe("anthropic");
  });

  it("works with no API key and binds to 127.0.0.1 by default", () => {
    expect(loadEnv(cli)).toMatchObject({
      COACH_PROVIDER: "claude-cli",
      HOST: "127.0.0.1",
    });
    expect(loadEnv(cli).ANTHROPIC_API_KEY).toBeUndefined();
    expect(
      loadEnv({ ...cli, HOST: "::1", WEB_ORIGIN: "http://127.0.0.1:3000" })
    ).toMatchObject({ HOST: "::1" });
    expect(
      loadEnv({ ...cli, ANTHROPIC_API_KEY: "  ", ANTHROPIC_AUTH_TOKEN: "" })
        .COACH_PROVIDER
    ).toBe("claude-cli");
  });

  it("refuses to start with an API key or auth token (no API billing by accident)", () => {
    expect(() => loadEnv({ ...cli, ANTHROPIC_API_KEY: "sk-ant-x" })).toThrow(
      /ANTHROPIC_API_KEY: must be unset/
    );
    expect(() => loadEnv({ ...cli, ANTHROPIC_AUTH_TOKEN: "t" })).toThrow(
      /ANTHROPIC_AUTH_TOKEN: must be unset/
    );
  });

  it("does not echo the key or token in the refusal", () => {
    try {
      loadEnv({
        ...cli,
        ANTHROPIC_API_KEY: "sk-ant-SECRET",
        ANTHROPIC_AUTH_TOKEN: "tok-SECRET",
      });
    } catch (e) {
      expect(String(e)).not.toContain("SECRET");
    }
  });

  it("refuses non-loopback hosts, non-local web origins and proxies", () => {
    for (const HOST of [
      "0.0.0.0",
      "::",
      "192.168.1.10",
      "localhost",
      "example.com",
    ]) {
      expect(() => loadEnv({ ...cli, HOST }), HOST).toThrow(
        /HOST: must be 127.0.0.1 or ::1/
      );
    }
    for (const WEB_ORIGIN of [
      "https://app.example.com",
      "http://192.168.1.10:3000",
      "http://localhost.example.com:3000",
    ]) {
      expect(() => loadEnv({ ...cli, WEB_ORIGIN }), WEB_ORIGIN).toThrow(
        /WEB_ORIGIN/
      );
    }
    expect(() => loadEnv({ ...cli, TRUST_PROXY_HOPS: "1" })).toThrow(
      /TRUST_PROXY_HOPS/
    );
  });

  it("CLAUDE_CLI_PATH is `claude` or an absolute path", () => {
    expect(
      loadEnv({ ...cli, CLAUDE_CLI_PATH: "/usr/local/bin/claude" })
        .CLAUDE_CLI_PATH
    ).toBe("/usr/local/bin/claude");
    for (const p of ["./claude", "claude; rm -rf /", "bin/claude"])
      expect(() => loadEnv({ ...cli, CLAUDE_CLI_PATH: p }), p).toThrow(
        /CLAUDE_CLI_PATH/
      );
  });
});

/** Run the middleware on a fake request. */
function check(remoteAddress: string, headers: Record<string, string>) {
  let status = 200;
  let passed = false;
  const res = { status: (s: number) => ((status = s), res), json: () => res };
  localOnly(
    { socket: { remoteAddress }, headers } as never,
    res as never,
    () => (passed = true)
  );
  return passed ? 200 : status;
}

describe("localOnly middleware", () => {
  it("lets this computer through (direct, and via the local Next.js proxy)", () => {
    expect(check("127.0.0.1", { host: "127.0.0.1:3001" })).toBe(200);
    expect(check("::1", { host: "localhost:3001" })).toBe(200);
    expect(check("::ffff:127.0.0.1", { host: "[::1]:3001" })).toBe(200);
    expect(
      check("127.0.0.1", {
        host: "127.0.0.1:3001",
        "x-forwarded-host": "127.0.0.1:3000",
        "x-forwarded-for": "127.0.0.1",
      })
    ).toBe(200);
  });

  it("rejects other machines", () => {
    expect(check("192.168.1.20", { host: "127.0.0.1:3001" })).toBe(403);
    expect(check("10.0.0.5", { host: "localhost:3001" })).toBe(403);
    expect(check("", { host: "localhost:3001" })).toBe(403);
  });

  it("rejects a forged or rebinding Host, and LAN clients relayed by a proxy", () => {
    expect(check("127.0.0.1", {})).toBe(403);
    expect(check("127.0.0.1", { host: "attacker.example:3001" })).toBe(403); // DNS rebinding
    expect(check("127.0.0.1", { host: "localhost.attacker.example" })).toBe(
      403
    );
    expect(check("127.0.0.1", { host: "user@localhost:3001" })).toBe(403);
    expect(check("127.0.0.1", { host: "localhost/evil" })).toBe(403);
    expect(
      check("127.0.0.1", {
        host: "localhost:3001",
        "x-forwarded-for": "192.168.1.20",
      })
    ).toBe(403);
    expect(
      check("127.0.0.1", {
        host: "localhost:3001",
        "x-forwarded-for": "127.0.0.1, 192.168.1.20",
      })
    ).toBe(403);
    expect(
      check("127.0.0.1", {
        host: "localhost:3001",
        "x-forwarded-host": "192.168.1.5:3000",
      })
    ).toBe(403);
  });

  it("setupApp installs it first, only for claude-cli", () => {
    const calls: unknown[] = [];
    const app = new Proxy(
      {},
      {
        get: (_t, k) =>
          k === "use" ? (f: unknown) => calls.push(f) : () => {},
      }
    );
    setupApp(app as never, {
      WEB_ORIGIN: "http://127.0.0.1:3000",
      TRUST_PROXY_HOPS: 0,
      COACH_PROVIDER: "claude-cli",
    });
    expect(calls[0]).toBe(localOnly);
    calls.length = 0;
    setupApp(app as never, {
      WEB_ORIGIN: "http://localhost:3000",
      TRUST_PROXY_HOPS: 0,
    });
    expect(calls).not.toContain(localOnly);
  });
});

/** A real socket from this machine's LAN-facing address, if it has one. */
const lan = Object.values(networkInterfaces())
  .flat()
  .find((i) => i && i.family === "IPv4" && !i.internal)?.address;

function get(
  host: string,
  port: number,
  hostHeader?: string
): Promise<number | string> {
  return new Promise((resolve) => {
    const r = request(
      {
        host,
        port,
        path: "/",
        headers: hostHeader ? { host: hostHeader } : {},
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      }
    );
    r.on("error", (e: NodeJS.ErrnoException) => resolve(e.code ?? "error"));
    r.end();
  });
}
const listen = (s: Server, host: string) =>
  new Promise<number>((ok) =>
    s.listen(0, host, () => ok((s.address() as AddressInfo).port))
  );

describe.skipIf(!lan)(`over the network (LAN address ${lan})`, () => {
  it("bound to 127.0.0.1, the LAN address cannot even connect", async () => {
    const s = createServer((_q, r) => r.end("ok"));
    const port = await listen(s, "127.0.0.1");
    try {
      expect(await get("127.0.0.1", port)).toBe(200);
      expect(await get(lan!, port)).toBe("ECONNREFUSED");
    } finally {
      s.close();
    }
  });

  it("even if bound to every interface, the guard answers 403 to a non-loopback peer", async () => {
    const app = express();
    app.use(localOnly);
    app.get("/", (_q, r) => void r.send("ok"));
    const s = createServer(app);
    const port = await listen(s, "0.0.0.0");
    try {
      expect(await get("127.0.0.1", port)).toBe(200);
      expect(await get(lan!, port)).toBe(403);
      expect(await get(lan!, port, `localhost:${port}`)).toBe(403); // a spoofed Host does not help
      expect(await get("127.0.0.1", port, "rebind.attacker.example")).toBe(403);
    } finally {
      s.close();
    }
  });
});
