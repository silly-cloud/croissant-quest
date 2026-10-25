import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

const config: NextConfig = {
  transpilePackages: ["@cq/shared", "@cq/content"],
  reactStrictMode: true,
  // the rewrite proxy cuts upstream calls at 30 s; a local Claude CLI round can take 40 s (coach cliTimeoutMs is 90 s)
  experimental: { proxyTimeout: 100_000 },
  // the real-API e2e build bakes another API_URL into the rewrites, so it gets its own output folder
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The device cookie must be first-party, so the browser only ever talks to this origin.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: `${API_URL}/v1/:path*` }];
  },
  // @cq/shared and @cq/content are TypeScript sources that import "./x.js" meaning "./x.ts".
  // Webpack needs to be told; Turbopack has no equivalent yet, so dev/build run with --webpack.
  webpack(cfg) {
    cfg.resolve.extensionAlias = {
      ...(cfg.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js"],
    };
    return cfg;
  },
};

export default config;
