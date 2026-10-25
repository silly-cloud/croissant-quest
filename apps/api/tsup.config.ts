import { defineConfig } from "tsup";

// Workspace packages ship TypeScript source, so bundle them; everything else stays external.
export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node22",
  platform: "node",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  noExternal: [/^@cq\//],
  tsconfig: "tsconfig.json",
});
