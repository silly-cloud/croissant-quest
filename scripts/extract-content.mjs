// One-off extraction of the question bank and static data from the legacy single-file game.
// Usage: node scripts/extract-content.mjs [path/to/legacy.html] (default: tests-legacy/croissant-quest.html, the frozen v18 fixture)
import fs from "node:fs";
import vm from "node:vm";

const src = process.argv[2] ?? "tests-legacy/croissant-quest.html";
const html = fs.readFileSync(src, "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)?.[1];
if (!js) throw new Error("no <script> found");

const start = js.indexOf("const W = {");
const stateMarker = js.indexOf("const MASTERED");
const dataJs = js.slice(start, stateMarker) + "\n;({W,TAG,TAGNAME,BANK,TOPICS,RULES})";
const out = vm.runInNewContext(dataJs, {}, { timeout: 5000 });

const outDir = new URL("../packages/content/data/", import.meta.url);
const write = (name, value) =>
  fs.writeFileSync(new URL(name, outDir), JSON.stringify(value, null, 1) + "\n");

// bank: drop undefined fields so the JSON is clean
const bank = out.BANK.map((q) => JSON.parse(JSON.stringify(q)));
write("bank.json", bank);
write("pron.json", out.W);
write("tags.json", { TAG: out.TAG, TAGNAME: out.TAGNAME });
write("topics.json", out.TOPICS);
write("rules.json", out.RULES);
console.log(`bank=${bank.length} words=${Object.keys(out.W).length} topics=${out.TOPICS.length}`);
