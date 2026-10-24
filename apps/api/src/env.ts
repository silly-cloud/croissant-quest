import { z } from "zod";

const unsetIfEmpty = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const EnvSchema = z.object({
  NODE_ENV: z.string().default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  /** Optional. Empty string counts as unset. Never logged, never returned. */
  ANTHROPIC_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : undefined)),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  /** Reduced to its origin: CORS compares against `Origin`, which never has a path or trailing slash. */
  WEB_ORIGIN: z.string().url().default("http://localhost:3000").transform((v) => new URL(v).origin),
  /** Defaults to true in production. The cookie only reaches the API from the same site (see README). */
  COOKIE_SECURE: z.preprocess(unsetIfEmpty, z.enum(["true", "false"]).optional()),
  /** Reverse proxies in front of the API whose X-Forwarded-For is trusted. 0 = none (never `true`). */
  TRUST_PROXY_HOPS: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(0).max(10).default(0)),
  /** Ceiling on coach calls per minute across all clients (each call costs money). */
  COACH_GLOBAL_PER_MIN: z.preprocess(unsetIfEmpty, z.coerce.number().int().min(1).max(100_000).default(120)),
}).transform((e) => ({ ...e, COOKIE_SECURE: e.COOKIE_SECURE ? e.COOKIE_SECURE === "true" : e.NODE_ENV === "production" }));
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const r = EnvSchema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  return r.data;
}
