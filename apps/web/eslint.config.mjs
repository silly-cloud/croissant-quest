import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

export default tseslint.config(
  // each package is its own tsconfig root: lint-staged lints files from several packages in one run
  { languageOptions: { parserOptions: { tsconfigRootDir: import.meta.dirname } } },
  { ignores: [".next", ".next-real", ".e2e-real","node_modules", "coverage", "next-env.d.ts", "playwright-report", "test-results"] },
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-restricted-syntax": [
        "error",
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: "Render rule text through <Rich>, never raw HTML." },
      ],
    },
  },
);
