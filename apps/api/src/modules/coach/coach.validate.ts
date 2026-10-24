import { z } from "zod";
import { BANK, Question, TAG, qid } from "@cq/content";
import { fullOf, norm, pron } from "@cq/shared";

/** The model's reply is the one untrusted input in this service. Everything below is a gate. */
const Row = z.object({
  s: z.string(),
  a: z.string(),
  o: z.array(z.string()),
  tag: z.string(),
  en: z.string().optional(),
  pe: z.string().optional(),
  pg: z.string().optional(),
  ph: z.string().optional(),
});

const BANK_QIDS = new Set(BANK.map(qid));
const bankSentences = new Set(
  BANK.flatMap((q) => [q.s, q.k === "choice" ? fullOf(q) : undefined]).flatMap((s) => (s ? [norm(s)] : [])),
);
/** No markup in anything that reaches a screen. */
const hasMarkup = (...xs: (string | undefined)[]) => xs.some((x) => x !== undefined && /[<>]/.test(x));

/** Pull a JSON array out of a reply, tolerating a code fence or a sentence around it. */
export function extractJsonArray(text: string): unknown[] | null {
  const tryParse = (t: string) => {
    try {
      const v: unknown = JSON.parse(t);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text.trim());
  if (direct) return direct;
  const a = text.indexOf("["), b = text.lastIndexOf("]");
  return a >= 0 && b > a ? tryParse(text.slice(a, b + 1)) : null;
}

/** Keep only rows that are real, new, answerable choice questions on a known rule. */
export function validateRound(rows: unknown[], max = 8): Question[] {
  const out: Question[] = [];
  const seenQid = new Set<string>();
  const seenSentence = new Set<string>();

  for (const raw of rows) {
    if (out.length >= max) break;
    const row = Row.safeParse(raw);
    if (!row.success) continue;
    const r = row.data;
    if (hasMarkup(r.s, r.a, r.en, r.pe, r.pg, r.ph, ...r.o)) continue;
    if (!Object.hasOwn(TAG, r.tag)) continue; // unknown rule: drop it, never default to "m"

    const o = [...new Set(r.o.map((x) => x.trim()).filter(Boolean))];
    const a = r.a.trim();
    const s = r.s.trim();
    if (!s.includes("___") || o.length < 2 || o.length > 6 || !o.includes(a)) continue;

    const draft = {
      t: 6, tier: 3, k: "choice" as const, _ai: true as const,
      s, a, en: (r.en ?? "").trim() || undefined, o, tag: r.tag,
    };
    const parsed = Question.safeParse(draft);
    if (!parsed.success) continue;
    const q = parsed.data;

    const id = qid(q);
    const sentence = norm(s), full = norm(fullOf(q));
    if (BANK_QIDS.has(id) || bankSentences.has(sentence) || bankSentences.has(full)) continue; // copy of the bank
    if (seenQid.has(id) || seenSentence.has(full)) continue; // duplicate in this batch
    seenQid.add(id);
    seenSentence.add(full);

    const model = { e: (r.pe ?? "").trim(), g: (r.pg ?? "").trim(), h: (r.ph ?? "").trim() };
    q.pr = model.e && model.g && model.h ? model : pron(fullOf(q));
    out.push(q);
  }
  return out;
}
