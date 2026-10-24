/**
 * Seed = validate the bank. Questions are served from @cq/content (not stored in Postgres), so there
 * is nothing to insert; the point is to fail loudly before a deploy if the bank is broken.
 * Run: pnpm --filter @cq/api db:seed
 */
import { BANK, Question, TAG, qid } from "@cq/content";

const problems: string[] = [];
const ids = new Set<string>();

BANK.forEach((q, i) => {
  const r = Question.safeParse(q);
  if (!r.success) problems.push(`#${i}: ${r.error.issues.map((x) => x.message).join("; ")}`);
  const id = qid(q);
  if (ids.has(id)) problems.push(`#${i}: duplicate qid ${id}`);
  ids.add(id);
  if (!Object.hasOwn(TAG, q.tag)) problems.push(`#${i}: unknown tag ${q.tag}`);
});

if (problems.length) {
  console.error(`Bank invalid (${problems.length} problems):\n` + problems.join("\n"));
  process.exit(1);
}
console.log(`Bank OK: ${BANK.length} questions, ${ids.size} unique ids.`);
