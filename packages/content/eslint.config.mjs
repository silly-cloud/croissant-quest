import tseslint from "typescript-eslint";
export default tseslint.config(
  // each package is its own tsconfig root: lint-staged lints files from several packages in one run
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  { ignores: ["dist", ".next", "node_modules", "coverage"] },
  ...tseslint.configs.recommended,
);
