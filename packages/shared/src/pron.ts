import { PRON_DICT } from "@cq/content";

export interface PronResult {
  e: string; // English phonetic
  g: string; // Gujarati
  h: string; // Devanagari
}

const VOW = "aàâeéèêiîoôuûyœ";
/** An aspirate h blocks liaison; only these mute-h words let it through (les hôtels, des hommes). */
const MUTEH = new Set(["homme", "hôtel", "huile", "hôpital", "hôpitaux", "heure", "histoire", "herbe", "habite", "hiver"]);
/** Words that really link to a following vowel. */
const LIAISE = new Set(["les", "des", "nous", "vous", "ils", "elles", "aux", "dans", "sans", "très", "ces", "mes", "tes", "ses"]);

const has = (k: string) => Object.prototype.hasOwnProperty.call(PRON_DICT, k);
const entry = (k: string) => (has(k) ? PRON_DICT[k]! : null);

export function pron(sentence: string): PronResult {
  const raw = sentence.replace(/[.?!,]/g, "").trim().split(/\s+/);
  const out: [string[], string[], string[]] = [[], [], []];
  for (let i = 0; i < raw.length; i++) {
    const word = raw[i]!;
    const key = word.toLowerCase().replace(/’/g, "'");
    const e = entry(key);
    const cur: [string, string, string] = e ? [...e] : [word, word, word];
    const nextWord = raw[i + 1];
    const nk = nextWord ? nextWord.toLowerCase().replace(/’/g, "'") : null;
    const nx = nk && (VOW.includes(nk[0]!) || MUTEH.has(nk)) ? entry(nk) : null;
    if (e && LIAISE.has(key) && nx) {
      out[0].push(cur[0] + "-z" + nx[0]);
      out[1].push(cur[1] + "ઝ઼" + nx[1]);
      out[2].push(cur[2] + "ज़" + nx[2]);
      i++;
      continue;
    }
    out[0].push(cur[0]);
    out[1].push(cur[1]);
    out[2].push(cur[2]);
  }
  const first = out[0].join(" ");
  return { e: first.charAt(0).toUpperCase() + first.slice(1), g: out[1].join(" "), h: out[2].join(" ") };
}
