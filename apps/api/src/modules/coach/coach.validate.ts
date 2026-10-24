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
/** Every sentence a bank question shows or answers with, whatever its kind: a model reply matching any is a copy. */
const bankSentences = new Set(
  BANK.flatMap((q) => [q.s, q.a, fullOf(q)]).flatMap((s) => (s ? [norm(s)] : [])),
);

/** The only answers a partitive-article choice question may have. */
const CLOSED = new Set(["du", "de la", "de l'", "des", "de", "d'", "le", "la", "les", "l'"]);
/** Which answers each rule tag allows. Tags not listed here (fix, gre) accept any of CLOSED; `sans` is dropped. */
const ALLOWED: Record<string, string[]> = {
  m: ["du"], f: ["de la"], v: ["de l'"], p: ["des"],
  neg: ["de", "d'"], qty: ["de", "d'"], gen: ["le", "la", "les", "l'"],
  sans: [],
};
const apos = (x: string) => x.trim().replace(/[’`´]/g, "'");
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

    const seenOpt = new Set<string>();
    const o = r.o.map(apos).filter((x) => {
      const k = x.toLowerCase();
      if (!x || seenOpt.has(k)) return false;
      seenOpt.add(k);
      return true;
    });
    const a = apos(r.a);
    const s = r.s.trim();
    if (s.split("___").length !== 2 || o.length < 2 || o.length > 6 || !o.includes(a)) continue;
    if (!CLOSED.has(a) || (ALLOWED[r.tag] && !ALLOWED[r.tag]!.includes(a))) continue;

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
