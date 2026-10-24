import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

const config: NextConfig = {
  transpilePackages: ["@cq/shared", "@cq/content"],
  reactStrictMode: true,
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
