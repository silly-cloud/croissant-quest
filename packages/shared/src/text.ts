import { qid, type Question } from "@cq/content";

export { qid };

/** Lowercase, straighten quotes, collapse spaces, drop final punctuation, close up elisions. */
export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(/\s*'\s*/g, "'");
}

export function deaccent(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** An elided answer must close up against its noun: "l' homme" -> "l'homme". */
export function knit(s: string): string {
  return s.replace(/'\s+/g, "'");
}

/** The finished French sentence for a question (what the learner should be able to say). */
export function fullOf(q: Question): string {
  if (q.k === "choice") return knit((q.s ?? "").replace("___", q.a));
  if (q.k === "fr2en") return q.s ?? "";
  return q.a;
}

/**
 * Is `picked` a correct answer to `q`?
 * choice/fr2en: exact option. fix: the tapped word is one of the wrong words.
 * type/en2fr/build: normalised full sentence, an `alt` reading, or (type) just the missing word.
 */
export function judge(q: Question, picked: string | null): boolean {
  const p = picked ?? "";
  if (q.k === "choice" || q.k === "fr2en") return p === q.a;
  if (q.k === "fix") return (q.bad ?? "").split(" ").includes(p);
  const said = norm(p);
  if (said === norm(q.a)) return true;
  if (q.alt?.some((a) => norm(a) === said)) return true;
  return !!(q.s && q.s.includes("___") && norm(knit(q.s.replace("___", p))) === norm(q.a));
}

/** Right words, wrong accents: shown as "So close". */
export function accentsOnly(q: Question, picked: string | null, ok: boolean): boolean {
  return (
    !ok &&
    (q.k === "type" || q.k === "en2fr" || q.k === "build") &&
    deaccent(norm(picked ?? "")) === deaccent(norm(q.a))
  );
}
