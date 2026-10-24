#!/usr/bin/env node
// Parity gate: every legacy test (tests-legacy/C-behave.js, fixes.js) must be covered by
//  (a) a C("...")/F("...") test in packages/shared/test/legacy-parity.test.ts with the exact legacy name, or
//  (b) a mapping row in docs/PARITY.md pointing at a test title that exists in the named file, or
//  (c) a row marked "UI-only: <reason>".
// Exit 1 if any legacy name has no mapping, or a mapping points at nothing.
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const STR = String.raw`"((?:[^"\\]|\\.)*)"`;
const names = (src, fn) =>
  [...src.matchAll(new RegExp(String.raw`^\s*${fn}\(\s*${STR}`, "gm"))].map((m) => JSON.parse(`"${m[1]}"`));

const legacy = [
  ...names(read("tests-legacy/C-behave.js"), "X?T").map((n) => ({ file: "C-behave", name: n })),
  ...names(read("tests-legacy/fixes.js"), "T").map((n) => ({ file: "fixes", name: n })),
];
const sharedSrc = read("packages/shared/test/legacy-parity.test.ts");
const sharedTitles = new Set([
  ...names(sharedSrc, "C").map((n) => `C-behave\u0000${n}`),
  ...names(sharedSrc, "F").map((n) => `fixes\u0000${n}`),
]);

// docs/PARITY.md table rows: | C12 | legacy name | where covered | status |
const rows = new Map();
for (const line of read("docs/PARITY.md").split("\n")) {
  const c = line.split(/(?<!\\)\|/).map((s) => s.trim());
  if (c.length >= 6 && /^(C|F)\d+$/.test(c[1])) rows.set(c[2], { id: c[1], where: c[3], status: c[4] });
}

const errors = [], out = [];
const tot = { shared: 0, elsewhere: 0, ui: 0, missing: 0 };
const REF = /`([^`]+)`\s*::\s*"([^"]+)"/g;

for (const t of legacy) {
  const inShared = sharedTitles.has(`${t.file}\u0000${t.name}`);
  const row = rows.get(t.name);
  const where = [];
  let other = false, ui = false;
  if (inShared) where.push("packages/shared/test/legacy-parity.test.ts");
  if (row) {
    if (/\bSHARED\b/.test(row.where) && !inShared) errors.push(`${t.name}: PARITY.md says SHARED but no C()/F() test has that name`);
    for (const m of row.where.matchAll(REF)) {
      const f = join(root, m[1]);
      if (!existsSync(f)) errors.push(`${t.name}: file not found ${m[1]}`);
      else if (!readFileSync(f, "utf8").includes(m[2])) errors.push(`${t.name}: title "${m[2]}" not found in ${m[1]}`);
      else { other = true; where.push(`${m[1]} :: ${m[2]}`); }
    }
    if (/UI-only:\s*\S/.test(row.where)) { ui = true; where.push(row.where.replace(/^.*?(UI-only:)/, "$1")); }
  }
  if (inShared) tot.shared++;
  else if (other) tot.elsewhere++;
  else if (ui) tot.ui++;
  else { tot.missing++; errors.push(`NO MAPPING: [${t.file}] ${t.name}`); }
  out.push(`${inShared ? "S" : other ? "W" : ui ? "U" : "!"} [${t.file}] ${t.name}\n      -> ${where.join(" | ") || "NONE"}`);
}
for (const n of rows.keys()) if (!legacy.some((t) => t.name === n)) errors.push(`PARITY.md row for unknown legacy test: ${n}`);
if (legacy.length !== 69) errors.push(`expected 69 legacy tests, parsed ${legacy.length}`);

console.log(out.join("\n"));
console.log(`\nlegacy tests: ${legacy.length} (C-behave ${legacy.filter((t) => t.file === "C-behave").length}, fixes ${legacy.filter((t) => t.file === "fixes").length})`);
console.log(`S  shared test with the exact legacy name: ${tot.shared}`);
console.log(`W  no shared twin, mapped to web/api/content test: ${tot.elsewhere}`);
console.log(`U  UI-only, reason given: ${tot.ui}`);
console.log(`!  unmapped: ${tot.missing}`);
if (errors.length) {
  console.error("\nPARITY GATE FAILED\n" + errors.map((e) => "  " + e).join("\n"));
  process.exit(1);
}
console.log("PARITY GATE OK");
