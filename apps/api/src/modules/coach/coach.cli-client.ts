import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Logger } from "@nestjs/common";
import {
  CoachClientError,
  type CoachClient,
  type CoachRequest,
} from "./coach.client.js";
import { coachConfig } from "./coach.config.js";

/**
 * COACH_PROVIDER=claude-cli (ADR 0011): the coach runs the locally installed, unmodified Claude Code CLI in
 * its documented headless mode (`claude -p`). The CLI signs in, refreshes its login and enforces the
 * subscription's limits itself. This file never opens ~/.claude, never sees a token, and never logs or
 * returns what the CLI prints.
 */

/** The only variables the child inherits. Anything that picks a credential or a provider is not here. */
const ENV_ALLOW = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TMPDIR",
  "CLAUDE_CONFIG_DIR",
  "NODE_EXTRA_CA_CERTS",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "NO_PROXY",
  "https_proxy",
  "http_proxy",
  "no_proxy",
] as const;

/** Variables that make the CLI use an API key, a gateway or another provider instead of the claude.ai login. */
export const BILLING_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_PROFILE",
  "ANTHROPIC_FEDERATION_RULE_ID",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
] as const;

/** The child's environment: the allow-list only, so no billing variable can ride along. */
export function childEnv(
  parent: NodeJS.ProcessEnv,
  extra: Record<string, string> = {}
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ENV_ALLOW) {
    const v = parent[k];
    if (typeof v === "string") out[k] = v;
  }
  Object.assign(out, extra);
  for (const k of BILLING_ENV) delete out[k];
  return out;
}

/**
 * Every flag is in `claude --help` (checked on v2.1.310) and the CLI reference. The prompt goes on stdin,
 * never on the command line, and there is no shell: argv is passed as-is.
 */
export function cliArgs(model: string): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--model",
    model,
    "--max-turns",
    "1",
    "--no-session-persistence",
    "--strict-mcp-config", // no MCP servers at all (none are passed)
    "--disable-slash-commands",
    "--setting-sources",
    "", // no user/project/local settings: no hooks, env blocks or apiKeyHelper from them
    "--system-prompt",
    SYSTEM_PROMPT,
    "--tools",
    "", // last: --tools takes a list
  ];
}

/** Replaces Claude Code's agent prompt: the coach only needs text back, and a short prompt uses less of the plan. */
const SYSTEM_PROMPT =
  "You are a French teacher's assistant. Answer the user's message exactly as it asks. You have no tools.";

const MAX_STDOUT = 1_000_000;
const MAX_STDERR = 64_000;
const KILL_GRACE_MS = 2_000;
const AUTH_TIMEOUT_MS = 15_000;
const AUTH_TTL_MS = 5 * 60_000;

/** Documented CLI messages (code.claude.com/docs/en/errors). */
const AUTH_RE =
  /not logged in|please run \/login|login expired|authentication required|sign in again|oauth token (?:has expired|revoked)|token revoked|invalid authentication credentials|could not resolve authentication method|does not have access to claude|disabled claude subscription access|authentication_failed/i;
const LIMIT_RE =
  /you[’']ve hit your [\w’' ]*limit|usage limit|rate[ _-]?limit|request rejected \(429\)|temporarily limiting requests/i;

/** Turn one `claude -p --output-format json` run into the model's text, or a classified CoachClientError. */
export function parseCliResult(
  code: number | null,
  stdout: string,
  stderr: string
): string {
  let res: Record<string, unknown> | null = null;
  try {
    const v: unknown = JSON.parse(stdout.trim());
    if (v && typeof v === "object" && !Array.isArray(v))
      res = v as Record<string, unknown>;
  } catch {
    res = null;
  }
  if (
    res &&
    code === 0 &&
    res.is_error === false &&
    res.subtype === "success" &&
    typeof res.result === "string"
  ) {
    return res.result;
  }
  const said =
    `${typeof res?.result === "string" ? res.result : stdout}\n${stderr}`.slice(
      0,
      8_000
    );
  const status =
    typeof res?.api_error_status === "number" ? res.api_error_status : null;
  if (status === 401 || AUTH_RE.test(said))
    throw new CoachClientError("login_required", false);
  if (status === 429 || LIMIT_RE.test(said))
    throw new CoachClientError("rate_limited", false);
  if (!res) throw new CoachClientError(code === 0 ? "invalid" : "error", false); // not JSON: a crash or a bad flag
  if (res.is_error !== true && code === 0)
    throw new CoachClientError("invalid", false); // ran, but no text result
  // a failed run: transient only if the API had no answer or a 5xx (the CLI has already retried those itself)
  throw new CoachClientError("error", status === null || status >= 500);
}

export type AuthState =
  | { ok: true; method: "claude.ai" }
  | { ok: false; problem: "cli_missing" | "unreadable" | "not_logged_in" }
  | { ok: false; problem: "not_subscription"; method: string };

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  overflow: boolean;
}

export interface ClaudeCliOptions {
  /** `claude` (looked up on PATH) or an absolute path. Comes from env, never from a request. */
  bin: string;
  model?: string;
  env?: NodeJS.ProcessEnv;
}

export class ClaudeCliCoachClient implements CoachClient {
  private readonly log = new Logger("CoachCli");
  private readonly live = new Set<number>();
  private authOkAt = 0;

  constructor(private readonly opts: ClaudeCliOptions) {}

  async complete(
    req: CoachRequest,
    { signal }: { signal: AbortSignal }
  ): Promise<string> {
    await this.requireSubscription(signal);
    const env = childEnv(this.opts.env ?? process.env, {
      CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(req.maxTokens),
    });
    const t0 = Date.now();
    const r = await this.run(
      cliArgs(this.opts.model ?? coachConfig.model),
      req.prompt,
      env,
      signal
    );
    // timing and token counts only, never the text
    this.log.log(
      `claude -p exit ${String(r.code)} in ${Date.now() - t0} ms${usageOf(r.stdout)}`
    );
    if (r.overflow) throw new CoachClientError("invalid", false);
    return parseCliResult(r.code, r.stdout, r.stderr);
  }

  /**
   * `claude auth status` reports which credential the CLI would use, without us touching it. Only
   * `loggedIn` and `authMethod` are read; the rest of the output is dropped.
   */
  async authState(outer?: AbortSignal): Promise<AuthState> {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), AUTH_TIMEOUT_MS);
    // the coach call's deadline covers this check too
    const onOuter = () => ctl.abort();
    outer?.addEventListener("abort", onOuter, { once: true });
    if (outer?.aborted) ctl.abort();
    let r: RunResult;
    try {
      r = await this.run(
        ["auth", "status"],
        "",
        childEnv(this.opts.env ?? process.env),
        ctl.signal
      );
    } catch (e) {
      return {
        ok: false,
        problem: e instanceof CoachClientError ? "cli_missing" : "unreadable",
      };
    } finally {
      clearTimeout(t);
      outer?.removeEventListener("abort", onOuter);
    }
    let s: { loggedIn?: unknown; authMethod?: unknown } = {};
    try {
      s = JSON.parse(r.stdout) as typeof s;
    } catch {
      return { ok: false, problem: "unreadable" };
    }
    const method = typeof s.authMethod === "string" ? s.authMethod : "unknown";
    if (s.loggedIn !== true || method === "none")
      return { ok: false, problem: "not_logged_in" };
    if (method !== "claude.ai")
      return { ok: false, problem: "not_subscription", method };
    return { ok: true, method };
  }

  /** Before a call: the CLI must be signed in with a claude.ai subscription, never an API key or provider. */
  private async requireSubscription(signal: AbortSignal): Promise<void> {
    if (Date.now() - this.authOkAt < AUTH_TTL_MS) return;
    const s = await this.authState(signal);
    if (signal.aborted) throw new Error("aborted");
    if (s.ok) {
      this.authOkAt = Date.now();
      return;
    }
    if (s.problem === "not_logged_in")
      throw new CoachClientError("login_required", false);
    if (s.problem === "not_subscription") {
      this.log.error(
        `Claude Code is using "${s.method}", not a claude.ai login: refusing (it could bill an API account)`
      );
    } else this.log.error(`claude auth status failed (${s.problem})`);
    throw new CoachClientError("error", false);
  }

  /** Stop every child still running (API shutdown). */
  close(): void {
    for (const pid of this.live) killGroup(pid, "SIGKILL");
    this.live.clear();
  }

  onApplicationShutdown(): void {
    this.close();
  }

  private async run(
    args: string[],
    stdin: string,
    env: Record<string, string>,
    signal: AbortSignal
  ): Promise<RunResult> {
    if (signal.aborted) throw new Error("aborted");
    const cwd = await mkdtemp(join(tmpdir(), "cq-claude-")); // empty: no CLAUDE.md, .mcp.json or project settings
    try {
      return await new Promise<RunResult>((resolve, reject) => {
        // detached: its own process group, so a kill reaches anything it started
        const child = spawn(this.opts.bin, args, {
          cwd,
          env,
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
          shell: false,
        });
        const pid = child.pid;
        const out: Buffer[] = [];
        const err: Buffer[] = [];
        let outLen = 0,
          errLen = 0,
          overflow = false,
          grace: NodeJS.Timeout | undefined;

        const stop = () => {
          if (pid === undefined) return;
          killGroup(pid, "SIGTERM");
          grace = setTimeout(() => killGroup(pid, "SIGKILL"), KILL_GRACE_MS);
          grace.unref();
        };
        const onAbort = () => stop();
        signal.addEventListener("abort", onAbort, { once: true });
        if (pid !== undefined) this.live.add(pid);

        child.stdout.on("data", (b: Buffer) => {
          outLen += b.length;
          if (outLen > MAX_STDOUT) {
            if (!overflow) stop();
            overflow = true;
          } else out.push(b);
        });
        child.stderr.on("data", (b: Buffer) => {
          errLen += b.length;
          if (errLen <= MAX_STDERR) err.push(b);
        });
        child.stdin.on("error", () => {}); // the child may exit before reading; its exit code tells us why
        child.stdin.end(stdin);

        const finish = () => {
          signal.removeEventListener("abort", onAbort);
          if (pid !== undefined) this.live.delete(pid);
        };
        child.on("error", (e: NodeJS.ErrnoException) => {
          finish();
          if (grace) clearTimeout(grace);
          this.log.error(
            e.code === "ENOENT"
              ? `Claude Code CLI not found (${this.opts.bin}): install it and run \`claude\` once`
              : `could not start Claude Code CLI (${e.code ?? "error"})`
          );
          reject(new CoachClientError("error", false));
        });
        child.on("close", (code) => {
          finish();
          // the group may still hold a grandchild after the leader exits: make sure it goes too
          if (signal.aborted || overflow) {
            if (grace) clearTimeout(grace);
            if (pid !== undefined) killGroup(pid, "SIGKILL");
          }
          if (signal.aborted) return reject(new Error("aborted"));
          resolve({
            code,
            stdout: Buffer.concat(out).toString("utf8"),
            stderr: Buffer.concat(err).toString("utf8"),
            overflow,
          });
        });
      });
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  }
}

function killGroup(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pid, sig);
  } catch {
    // already gone
  }
}

/**
 * ", model claude-sonnet-5-5, 812 output tokens (0 thinking), CLI 14200 ms": the model the CLI reports in
 * `modelUsage` (not the one we asked for), or "unknown", plus token counts when present. Never any text.
 */
export function usageOf(stdout: string): string {
  let j: {
    duration_ms?: unknown;
    modelUsage?: unknown;
    usage?: {
      output_tokens?: unknown;
      output_tokens_details?: { thinking_tokens?: unknown };
    };
  };
  try {
    j = JSON.parse(stdout) as typeof j;
  } catch {
    return ", model unknown";
  }
  if (!j || typeof j !== "object") return ", model unknown";
  const mu = j.modelUsage;
  // model names only: anything that doesn't look like a model id is not logged
  const names =
    mu && typeof mu === "object" && !Array.isArray(mu)
      ? Object.keys(mu).filter((k) => /^[A-Za-z0-9][\w.:@/[\]-]{0,99}$/.test(k))
      : [];
  const model = `, model ${names.length ? names.join("+") : "unknown"}`;
  const out = j.usage?.output_tokens;
  const think = j.usage?.output_tokens_details?.thinking_tokens;
  if (typeof out !== "number") return model;
  return `${model}, ${out} output tokens (${typeof think === "number" ? think : "?"} thinking), CLI ${String(j.duration_ms ?? "?")} ms`;
}
