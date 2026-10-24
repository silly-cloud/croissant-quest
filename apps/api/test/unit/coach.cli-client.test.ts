import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { normState } from "@cq/shared";
import { CoachClientError } from "../../src/modules/coach/coach.client.js";
import {
  ClaudeCliCoachClient,
  childEnv,
  cliArgs,
  parseCliResult,
  usageOf,
} from "../../src/modules/coach/coach.cli-client.js";
import {
  coachConfig,
  coachConfigFor,
  type CoachConfig,
} from "../../src/modules/coach/coach.config.js";
import { CoachService } from "../../src/modules/coach/coach.service.js";

/**
 * A fake `claude` per scenario. The client passes it no scenario variables (its env is an allow-list),
 * so each scenario is its own script. Every run appends {argv, env, stdin, cwd, pid} to `log`.
 */
const root = mkdtempSync(join(tmpdir(), "cq-fake-claude-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const AUTH_OK = {
  loggedIn: true,
  authMethod: "claude.ai",
  apiProvider: "firstParty",
};
const result = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    api_error_status: null,
    result: "Bonjour",
    ...over,
  });

let n = 0;
function fake(opts: { auth?: object; authExit?: number; body: string }) {
  const dir = join(root, `s${++n}`);
  const log = join(dir, "log.jsonl");
  const bin = join(dir, "claude");
  mkdirSync(dir);
  writeFileSync(
    bin,
    `#!/usr/bin/env node
const fs = require("node:fs");
const argv = process.argv.slice(2);
let stdin = "";
process.stdin.on("data", (d) => (stdin += d));
process.stdin.on("end", () => {
  fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, env: process.env, stdin, cwd: process.cwd(), pid: process.pid }) + "\\n");
  if (argv[0] === "auth") {
    process.stdout.write(${JSON.stringify(JSON.stringify(opts.auth ?? AUTH_OK))});
    process.exit(${opts.authExit ?? 0});
  }
  ${opts.body}
});
`
  );
  chmodSync(bin, 0o755);
  const runs = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .map(
            (l) =>
              JSON.parse(l) as {
                argv: string[];
                env: Record<string, string>;
                stdin: string;
                cwd: string;
                pid: number;
              }
          )
      : [];
  return { bin, runs };
}
const printRuns = (f: ReturnType<typeof fake>) =>
  f.runs().filter((r) => r.argv[0] === "-p");

const PARENT_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  ANTHROPIC_API_KEY: "sk-ant-should-never-reach-the-child",
  ANTHROPIC_AUTH_TOKEN: "tok-should-never-reach-the-child",
  ANTHROPIC_BASE_URL: "https://gateway.example",
  CLAUDE_CODE_OAUTH_TOKEN: "oat-should-never-reach-the-child",
  CLAUDE_CODE_USE_BEDROCK: "1",
  DATABASE_URL: "postgresql://secret@db/cq",
};
const client = (bin: string) =>
  new ClaudeCliCoachClient({ bin, env: PARENT_ENV });
const go = (c: ClaudeCliCoachClient, signal = new AbortController().signal) =>
  c.complete(
    { prompt: 'Écris une phrase; $(rm -rf /) `x` "q"', maxTokens: 300 },
    { signal }
  );
const reasonOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return "resolved";
  } catch (e) {
    return e instanceof CoachClientError ? e.reason : "other";
  }
};
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const waitDead = async (pid: number, ms = 4_000) => {
  for (const end = Date.now() + ms; Date.now() < end;) {
    if (!alive(pid)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return !alive(pid);
};

describe("claude-cli client: success", () => {
  it("returns the result text; prompt only on stdin; documented flags; isolated cwd", async () => {
    const f = fake({
      body: `process.stdout.write(${JSON.stringify(result())}); process.exit(0);`,
    });
    expect(await go(client(f.bin))).toBe("Bonjour");
    const [run] = printRuns(f);
    expect(run!.stdin).toBe('Écris une phrase; $(rm -rf /) `x` "q"');
    expect(run!.argv).toEqual(cliArgs(coachConfig.model));
    expect(run!.argv.join(" ")).not.toContain("Écris");
    expect(run!.argv).toEqual(
      expect.arrayContaining([
        "-p",
        "--no-session-persistence",
        "--disable-slash-commands",
        "--strict-mcp-config",
      ])
    );
    expect(run!.argv.slice(-2)).toEqual(["--tools", ""]);
    expect(run!.argv[run!.argv.indexOf("--max-turns") + 1]).toBe("1");
    expect(run!.argv[run!.argv.indexOf("--output-format") + 1]).toBe("json");
    expect(run!.cwd).toMatch(/cq-claude-/);
    expect(existsSync(run!.cwd)).toBe(false); // removed after the run
  });

  it("the child gets no API key, auth token, gateway, provider or app secret", async () => {
    const f = fake({
      body: `process.stdout.write(${JSON.stringify(result())}); process.exit(0);`,
    });
    await go(client(f.bin));
    for (const run of f.runs()) {
      for (const k of [
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_AUTH_TOKEN",
        "ANTHROPIC_BASE_URL",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "CLAUDE_CODE_USE_BEDROCK",
        "DATABASE_URL",
      ]) {
        expect(run.env[k], `${run.argv[0]} ${k}`).toBeUndefined();
      }
      expect(run.env.HOME).toBe(process.env.HOME);
    }
    expect(printRuns(f)[0]!.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("300");
    expect(f.runs().map((r) => r.argv[0])).toEqual(["auth", "-p"]); // checked the login first
  });

  it("childEnv drops billing variables even if passed as extras", () => {
    const e = childEnv(
      { PATH: "/bin", ANTHROPIC_API_KEY: "k" },
      { ANTHROPIC_API_KEY: "k2", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "9" }
    );
    expect(e).toEqual({ PATH: "/bin", CLAUDE_CODE_MAX_OUTPUT_TOKENS: "9" });
  });
});

describe("claude-cli client: failures", () => {
  it("malformed output: invalid", async () => {
    const f = fake({
      body: `process.stdout.write("not json at all"); process.exit(0);`,
    });
    expect(await reasonOf(go(client(f.bin)))).toBe("invalid");
  });

  it("signed out (auth status): login_required, and no -p run at all", async () => {
    const f = fake({
      auth: { loggedIn: false, authMethod: "none" },
      authExit: 1,
      body: `process.exit(0);`,
    });
    expect(await reasonOf(go(client(f.bin)))).toBe("login_required");
    expect(printRuns(f)).toHaveLength(0);
  });

  it("expired login reported by the run: login_required", async () => {
    const out = result({
      subtype: "success",
      is_error: true,
      api_error_status: 401,
      result: "Login expired · Please run /login",
    });
    const f = fake({
      body: `process.stdout.write(${JSON.stringify(out)}); process.exit(1);`,
    });
    expect(await reasonOf(go(client(f.bin)))).toBe("login_required");
  });

  it("not logged in as plain text on stderr: login_required", async () => {
    const f = fake({
      body: `process.stderr.write("Not logged in · Please run /login\\n"); process.exit(1);`,
    });
    expect(await reasonOf(go(client(f.bin)))).toBe("login_required");
  });

  it("subscription limit: rate_limited", async () => {
    const out = result({
      is_error: true,
      result: "You've hit your session limit · resets 3pm",
    });
    const f = fake({
      body: `process.stdout.write(${JSON.stringify(out)}); process.exit(1);`,
    });
    expect(await reasonOf(go(client(f.bin)))).toBe("rate_limited");
  });

  it("an API key or other provider configured in the CLI: refused before any -p run", async () => {
    for (const authMethod of [
      "api_key",
      "api_key_helper",
      "third_party",
      "oauth_token",
    ]) {
      const f = fake({
        auth: { loggedIn: true, authMethod },
        body: `process.exit(0);`,
      });
      const c = client(f.bin);
      expect(await c.authState()).toEqual({
        ok: false,
        problem: "not_subscription",
        method: authMethod,
      });
      expect(await reasonOf(go(c))).toBe("error");
      expect(printRuns(f)).toHaveLength(0);
    }
  });

  it("CLI not installed: error, authState cli_missing", async () => {
    const c = client(join(root, "no-such-claude"));
    expect(await c.authState()).toEqual({ ok: false, problem: "cli_missing" });
    expect(await reasonOf(go(c))).toBe("error");
  });

  it("output over 1 MB: the child is stopped and the answer is invalid", async () => {
    const f = fake({
      body: `const b = "x".repeat(65536); const w = () => { while (process.stdout.write(b)); process.stdout.once("drain", w); }; w();`,
    });
    expect(await reasonOf(go(client(f.bin)))).toBe("invalid");
    expect(await waitDead(printRuns(f)[0]!.pid)).toBe(true);
  });
});

describe("claude-cli client: timeout, abort and cleanup", () => {
  // the fake ignores SIGTERM and starts a grandchild, so only a process-group SIGKILL ends both
  const hang = (pidFile: string) =>
    `process.on("SIGTERM", () => {});
     const g = require("node:child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
     require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(g.pid));
     setInterval(() => {}, 1000);`;

  it("abort kills the child and its grandchild (SIGTERM, then SIGKILL)", async () => {
    const pidFile = join(root, "g1.pid");
    const f = fake({ body: hang(pidFile) });
    const ctl = new AbortController();
    const p = reasonOf(go(client(f.bin), ctl.signal));
    for (let i = 0; i < 100 && !existsSync(pidFile); i++)
      await new Promise((r) => setTimeout(r, 50));
    ctl.abort();
    expect(await p).toBe("other"); // aborted: CoachService reports it as a timeout
    const grand = Number(readFileSync(pidFile, "utf8"));
    expect(await waitDead(printRuns(f)[0]!.pid)).toBe(true);
    expect(await waitDead(grand)).toBe(true);
  }, 15_000);

  it("CoachService deadline: timeout fallback, child gone", async () => {
    const pidFile = join(root, "g2.pid");
    const f = fake({ body: hang(pidFile) });
    const cfg: CoachConfig = {
      ...coachConfig,
      timeoutMs: 1_500,
      retries: 2,
      backoffMs: 1,
    };
    const svc = new CoachService(client(f.bin), cfg, {
      get: async () => ({ state: normState({}), version: 0 }),
    } as never);
    expect(await svc.round("u", { n: 8, focus: [] })).toEqual({
      fallback: true,
      reason: "timeout",
    });
    expect(await waitDead(printRuns(f)[0]!.pid)).toBe(true);
    expect(await waitDead(Number(readFileSync(pidFile, "utf8")))).toBe(true);
  }, 15_000);

  it("a hung `claude auth status` is bounded by the coach deadline too", async () => {
    const dir = join(root, "hung-auth");
    mkdirSync(dir);
    const bin = join(dir, "claude");
    writeFileSync(
      bin,
      `#!/usr/bin/env node\nprocess.on("SIGTERM", () => {}); setInterval(() => {}, 1000);\n`
    );
    chmodSync(bin, 0o755);
    const cfg: CoachConfig = {
      ...coachConfig,
      timeoutMs: 800,
      retries: 0,
      backoffMs: 1,
    };
    const svc = new CoachService(client(bin), cfg, {
      get: async () => ({ state: normState({}), version: 0 }),
    } as never);
    const t0 = Date.now();
    expect(await svc.round("u", { n: 8, focus: [] })).toEqual({
      fallback: true,
      reason: "timeout",
    });
    expect(Date.now() - t0).toBeLessThan(4_000); // deadline + kill grace, not the 15 s auth timeout
  }, 15_000);

  it("close() (API shutdown) kills a run still in flight", async () => {
    const pidFile = join(root, "g3.pid");
    const f = fake({ body: hang(pidFile) });
    const c = client(f.bin);
    const p = reasonOf(go(c));
    for (let i = 0; i < 100 && !existsSync(pidFile); i++)
      await new Promise((r) => setTimeout(r, 50));
    c.close();
    expect(await waitDead(printRuns(f)[0]!.pid)).toBe(true);
    expect(await waitDead(Number(readFileSync(pidFile, "utf8")))).toBe(true);
    expect(await p).not.toBe("resolved");
  }, 15_000);
});

describe("CoachService with the CLI client: what reaches the browser, and retries", () => {
  const svc = (bin: string) =>
    new CoachService(
      client(bin),
      { ...coachConfig, timeoutMs: 5_000, retries: 2, backoffMs: 1 },
      { get: async () => ({ state: normState({}), version: 0 }) } as never
    );

  it("rate limit and expired login: one run, no retry, bare reason only", async () => {
    for (const [text, reason] of [
      ["You've hit your weekly limit · resets Mon 9am", "rate_limited"],
      ["Login expired · Please run /login", "login_required"],
    ] as const) {
      const f = fake({
        body: `process.stdout.write(${JSON.stringify(result({ is_error: true, result: text }))}); process.exit(1);`,
      });
      const out = await svc(f.bin).round("u", { n: 8, focus: [] });
      expect(out).toEqual({ fallback: true, reason });
      expect(JSON.stringify(out)).not.toContain("resets");
      expect(printRuns(f)).toHaveLength(1);
    }
  });

  it("a 5xx failure is retried within the deadline, then reported as error", async () => {
    const out = result({
      is_error: true,
      api_error_status: 529,
      result: "API Error: overloaded",
    });
    const f = fake({
      body: `process.stdout.write(${JSON.stringify(out)}); process.exit(1);`,
    });
    expect(await svc(f.bin).round("u", { n: 8, focus: [] })).toEqual({
      fallback: true,
      reason: "error",
    });
    expect(printRuns(f)).toHaveLength(3); // first try + 2 retries
  });

  it("a real model reply goes through the normal validator (no local-round fallback)", async () => {
    const rows = [
      {
        s: "Paul coupe ___ pain frais.",
        a: "du",
        o: ["du", "de la", "de l'", "des"],
        tag: "m",
      },
      {
        s: "Elle boit ___ eau minerale.",
        a: "de l'",
        o: ["du", "de la", "de l'", "des"],
        tag: "v",
      },
      {
        s: "Nous prenons ___ salade.",
        a: "de la",
        o: ["du", "de la", "de l'", "des"],
        tag: "f",
      },
      {
        s: "Tu achetes ___ pommes.",
        a: "des",
        o: ["du", "de la", "de l'", "des"],
        tag: "p",
      },
    ];
    const f = fake({
      body: `process.stdout.write(${JSON.stringify(result({ result: JSON.stringify(rows) }))}); process.exit(0);`,
    });
    const out = await svc(f.bin).round("u", { n: 8, focus: [] });
    expect(out.fallback).toBe(false);
  });
});

describe("parseCliResult", () => {
  const err = (f: () => unknown) => {
    try {
      f();
      return null;
    } catch (e) {
      return e instanceof CoachClientError ? [e.reason, e.retryable] : "other";
    }
  };
  it("classifies documented messages", () => {
    expect(parseCliResult(0, result({ result: "ok" }), "")).toBe("ok");
    expect(
      err(() =>
        parseCliResult(
          1,
          result({
            is_error: true,
            result: "Not logged in · Please run /login",
          }),
          ""
        )
      )
    ).toEqual(["login_required", false]);
    expect(
      err(() =>
        parseCliResult(
          1,
          result({ is_error: true, result: "OAuth token has expired" }),
          ""
        )
      )
    ).toEqual(["login_required", false]);
    expect(
      err(() =>
        parseCliResult(
          1,
          result({ is_error: true, result: "x", api_error_status: 401 }),
          ""
        )
      )
    ).toEqual(["login_required", false]);
    expect(
      err(() =>
        parseCliResult(
          1,
          result({ is_error: true, result: "You’ve hit your Opus limit" }),
          ""
        )
      )
    ).toEqual(["rate_limited", false]);
    expect(
      err(() =>
        parseCliResult(
          1,
          result({ is_error: true, result: "Request rejected (429)" }),
          ""
        )
      )
    ).toEqual(["rate_limited", false]);
    expect(
      err(() =>
        parseCliResult(
          1,
          result({ is_error: true, result: "x", api_error_status: 429 }),
          ""
        )
      )
    ).toEqual(["rate_limited", false]);
    expect(
      err(() =>
        parseCliResult(
          1,
          result({ is_error: true, result: "boom", api_error_status: 500 }),
          ""
        )
      )
    ).toEqual(["error", true]);
    expect(
      err(() =>
        parseCliResult(
          1,
          result({ is_error: true, result: "bad", api_error_status: 400 }),
          ""
        )
      )
    ).toEqual(["error", false]);
    expect(
      err(() => parseCliResult(1, "", "error: unknown option '--x'"))
    ).toEqual(["error", false]);
    expect(err(() => parseCliResult(0, "<html>", ""))).toEqual([
      "invalid",
      false,
    ]);
    expect(
      err(() =>
        parseCliResult(
          0,
          result({ subtype: "error_max_turns", result: undefined }),
          ""
        )
      )
    ).toEqual(["invalid", false]);
  });
  it("a successful answer that mentions limits is still a success", () => {
    expect(
      parseCliResult(
        0,
        result({ result: "The rate limit is fine; please run /login later" }),
        ""
      )
    ).toContain("rate limit");
  });
});

describe("deadlines and timing log", () => {
  it("the CLI provider gets its own 90 s deadline; the API provider keeps 25 s", () => {
    expect(coachConfigFor("anthropic").timeoutMs).toBe(25_000);
    expect(coachConfigFor("claude-cli").timeoutMs).toBe(90_000);
    expect(coachConfigFor("claude-cli").model).toBe(coachConfig.model);
  });
  it("usageOf reports counts only, never the text", () => {
    const out = result({
      result: "SECRET TEXT",
      duration_ms: 14200,
      usage: {
        output_tokens: 812,
        output_tokens_details: { thinking_tokens: 0 },
      },
    });
    expect(usageOf(out)).toBe(
      ", model unknown, 812 output tokens (0 thinking), CLI 14200 ms"
    );
    expect(usageOf(out)).not.toContain("SECRET");
    expect(usageOf("garbage")).toBe(", model unknown");
  });

  it("usageOf logs the model the CLI reports in modelUsage, not the configured one", () => {
    const u = {
      output_tokens: 900,
      output_tokens_details: { thinking_tokens: 12 },
    };
    const one = result({
      duration_ms: 27000,
      usage: u,
      modelUsage: { "claude-sonnet-5-5": { outputTokens: 900 } },
    });
    expect(usageOf(one)).toBe(
      ", model claude-sonnet-5-5, 900 output tokens (12 thinking), CLI 27000 ms"
    );
    const other = result({ usage: u, modelUsage: { "claude-haiku-5-5": {} } });
    expect(usageOf(other)).toContain("model claude-haiku-5-5,"); // whatever actually ran, even if not configured
    const two = result({
      modelUsage: { "claude-sonnet-5-5": {}, "claude-haiku-5-5": {} },
    });
    expect(usageOf(two)).toBe(", model claude-sonnet-5-5+claude-haiku-5-5");
  });

  it("usageOf: missing or unexpected modelUsage gives model unknown", () => {
    for (const modelUsage of [
      undefined,
      null,
      {},
      [],
      "claude-sonnet-5-5",
      42,
      { "bad name\ninjected": {} },
    ]) {
      expect(usageOf(result({ modelUsage })), JSON.stringify(modelUsage)).toBe(
        ", model unknown"
      );
    }
    expect(usageOf("null")).toBe(", model unknown");
    expect(usageOf("")).toBe(", model unknown");
  });
});
