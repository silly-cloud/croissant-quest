import { z } from "zod";

const unsetIfEmpty = (v: unknown) =>
  typeof v === "string" && v.trim() === "" ? undefined : v;

/** Interfaces that only this machine can reach. */
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1"]);
/** Hostnames (as `URL.hostname` gives them) that mean this machine. */
export const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const limit = (def: number) =>
  z.preprocess(
    unsetIfEmpty,
    z.coerce.number().int().min(1).max(1_000_000).default(def)
  );

export const EnvSchema = z
  .object({
    NODE_ENV: z.string().default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    /** Optional. Empty string counts as unset. Never logged, never returned. */
    ANTHROPIC_API_KEY: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? v.trim() : undefined)),
    /**
     * Which model client the coach uses. `anthropic` (default): the API with ANTHROPIC_API_KEY.
     * `claude-cli`: the local Claude Code CLI and its own claude.ai login, no API key (ADR 0011). Never automatic.
     */
    COACH_PROVIDER: z.preprocess(
      unsetIfEmpty,
      z.enum(["anthropic", "claude-cli"]).default("anthropic")
    ),
    /** Only read to refuse it under claude-cli: the CLI would bill this token instead of the subscription. */
    ANTHROPIC_AUTH_TOKEN: z
      .string()
      .optional()
      .transform((v) => (v && v.trim() ? "set" : undefined)),
    /** The CLI to run under claude-cli: `claude` (from PATH) or an absolute path. */
    CLAUDE_CLI_PATH: z.preprocess(
      unsetIfEmpty,
      z
        .string()
        .regex(/^(claude|\/[^\0\n]+)$/, "must be `claude` or an absolute path")
        .default("claude")
    ),
    /** Interface to listen on. Unset: all interfaces (Docker). claude-cli: loopback only, default 127.0.0.1. */
    HOST: z.preprocess(unsetIfEmpty, z.string().optional()),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    /** Reduced to its origin: CORS compares against `Origin`, which never has a path or trailing slash. */
    WEB_ORIGIN: z
      .string()
      .url()
      .default("http://localhost:3000")
      .refine(
        (v) => /^https?:$/.test(new URL(v).protocol),
        "must be an http(s) URL"
      )
      .transform((v) => new URL(v).origin),
    /**
     * Controlled phone test only (claude-cli): the one browser origin and the one client IPv4 allowed besides
     * this computer. Both or neither. The firewall is the real gate; this makes the app agree with it.
     */
    PUBLIC_TEST_ORIGIN: z.preprocess(unsetIfEmpty, z.string().url().optional()),
    PUBLIC_TEST_CLIENT_IP: z.preprocess(
      unsetIfEmpty,
      z
        .string()
        .regex(/^(\d{1,3}\.){3}\d{1,3}$/, "must be one IPv4 address")
        .optional()
    ),
    /** Defaults to true in production. The cookie only reaches the API from the same site (see README). */
    COOKIE_SECURE: z.preprocess(
      unsetIfEmpty,
      z.enum(["true", "false"]).optional()
    ),
    /** Reverse proxies in front of the API whose X-Forwarded-For is trusted. 0 = none (never `true`). */
    TRUST_PROXY_HOPS: z.preprocess(
      unsetIfEmpty,
      z.coerce.number().int().min(0).max(10).default(0)
    ),
    /** Ceiling on coach calls per minute across all clients (each call costs money). */
    COACH_GLOBAL_PER_MIN: limit(120),
    /** Coach abuse limits (ADR 0009). All are checked on every coach call. */
    COACH_DEVICE_PER_DAY: limit(50),
    COACH_IP_PER_MIN: limit(20),
    COACH_GLOBAL_PER_DAY: limit(500),
    /** New devices (User rows) one client IP may create per hour via GET /v1/progress. */
    DEVICE_CREATE_PER_IP_PER_HOUR: limit(20),
  })
  .superRefine((e, ctx) => {
    if (e.COACH_PROVIDER !== "claude-cli") return;
    // the subscription-backed coach must never be reachable from another machine, nor bill an API account
    const bad = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (e.ANTHROPIC_API_KEY)
      bad(
        "ANTHROPIC_API_KEY",
        "must be unset with COACH_PROVIDER=claude-cli (it would bill the API, not your subscription)"
      );
    if (e.ANTHROPIC_AUTH_TOKEN)
      bad(
        "ANTHROPIC_AUTH_TOKEN",
        "must be unset with COACH_PROVIDER=claude-cli (it would bypass your claude.ai login)"
      );
    if (e.HOST !== undefined && !LOOPBACK_HOSTS.has(e.HOST))
      bad("HOST", "must be 127.0.0.1 or ::1 with COACH_PROVIDER=claude-cli");
    if (
      (e.PUBLIC_TEST_ORIGIN === undefined) !==
      (e.PUBLIC_TEST_CLIENT_IP === undefined)
    )
      bad(
        "PUBLIC_TEST_ORIGIN",
        "PUBLIC_TEST_ORIGIN and PUBLIC_TEST_CLIENT_IP must be set together"
      );
    const publicOrigin =
      e.PUBLIC_TEST_ORIGIN && new URL(e.PUBLIC_TEST_ORIGIN).origin;
    if (
      !LOCAL_NAMES.has(new URL(e.WEB_ORIGIN).hostname) &&
      e.WEB_ORIGIN !== publicOrigin
    )
      bad(
        "WEB_ORIGIN",
        "must be http://localhost:<port> or http://127.0.0.1:<port> with COACH_PROVIDER=claude-cli"
      );
    if (e.TRUST_PROXY_HOPS !== 0)
      bad(
        "TRUST_PROXY_HOPS",
        "must be 0 with COACH_PROVIDER=claude-cli (no reverse proxy in front of a local app)"
      );
  })
  .transform((e) => ({
    ...e,
    HOST:
      e.HOST ?? (e.COACH_PROVIDER === "claude-cli" ? "127.0.0.1" : undefined),
    COOKIE_SECURE: e.COOKIE_SECURE
      ? e.COOKIE_SECURE === "true"
      : e.NODE_ENV === "production",
  }));
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(
  source: Record<string, string | undefined> = process.env
): Env {
  const r = EnvSchema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return r.data;
}
