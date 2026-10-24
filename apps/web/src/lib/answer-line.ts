import type { Question } from "@cq/content";
import { fullOf, knit } from "@cq/shared";

export interface AnswerPart {
  text: string;
  /** the part the learner had to supply */
  em: boolean;
}

/**
 * The finished French sentence as parts, so the why-card can underline what was missing.
 * Joined, the parts always equal fullOf(q): a typed or built answer is already the whole sentence
 * and is never spliced into q.s a second time.
 */
export function answerParts(q: Question): AnswerPart[] {
  if (q.k === "choice" && q.s?.includes("___")) {
    const [before = "", after = ""] = q.s.split("___");
    // an elision must close up against its noun: "de l'" + " eau" -> "de l'eau"
    const tail = q.a.endsWith("'") ? after.replace(/^\s+/, "") : after;
    return [
      { text: before, em: false },
      { text: q.a, em: true },
      { text: tail, em: false },
    ].filter((p) => p.text !== "");
  }
  return [{ text: fullOf(q), em: true }];
}

export const joinParts = (parts: AnswerPart[]) => knit(parts.map((p) => p.text).join(""));
