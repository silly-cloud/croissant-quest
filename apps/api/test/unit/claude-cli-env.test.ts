import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.js";

const base = { DATABASE_URL: "postgresql://x" };
const cli = { ...base, COACH_PROVIDER: "claude-cli" };

describe("env: COACH_PROVIDER=claude-cli", () => {
  it("is never chosen automatically; anthropic keeps listening as before", () => {
    expect(loadEnv(base)).toMatchObject({
      COACH_PROVIDER: "anthropic",
      CLAUDE_CLI_PATH: "claude",
    });
    expect(loadEnv(base).HOST).toBeUndefined();
    expect(
      loadEnv({ ...base, ANTHROPIC_API_KEY: "sk-ant-x" }).COACH_PROVIDER
    ).toBe("anthropic");
  });

  it("works with no API key", () => {
    expect(loadEnv(cli).COACH_PROVIDER).toBe("claude-cli");
    expect(loadEnv(cli).HOST).toBeUndefined(); // all interfaces, like anthropic
    expect(loadEnv(cli).ANTHROPIC_API_KEY).toBeUndefined();
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

  it("accepts any host, web origin and proxy setting, like the anthropic provider", () => {
    expect(
      loadEnv({
        ...cli,
        HOST: "0.0.0.0",
        WEB_ORIGIN: "https://app.example.com",
        TRUST_PROXY_HOPS: "1",
      })
    ).toMatchObject({
      HOST: "0.0.0.0",
      WEB_ORIGIN: "https://app.example.com",
      TRUST_PROXY_HOPS: 1,
    });
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
