import { TAGNAME, qid, type Question } from "@cq/content";
import { tagStats, type State } from "@cq/shared";

/** Progress you can paste back into a conversation with Claude. */
export function progressText(s: State, bank: Question[]): string {
  const stats = tagStats(s, TAGNAME);
  const total6 = bank.filter((q) => q.t === 6).length;
  const done6 = bank.filter((q) => q.t === 6 && s.seen[qid(q)]).length;
  let out = "## Croissant Quest: progress\n";
  out += `XP ${s.xp} · streak ${s.streak} · croissants ${s.cro} · rounds ${s.rounds}\n`;
  out += `Partitives: crown ${s.crowns[6] ?? 0}/5 · exercises seen ${done6}/${total6}\n`;
  const lf = s.feelLog.slice(-1)[0];
  if (lf) out += `Feel meter: I said ${lf.feel}% · game said ${lf.mine}% · drill mode ${s.calib}\n`;
  out += "\n### Rule-by-rule (lifetime)\n";
  for (const x of stats) out += `- ${x.name}: ${x.right}/${x.total} (${x.pct}%)\n`;
  const recent = s.log.slice(-15);
  if (recent.length) {
    out += `\n### Last ${recent.length} mistakes\n`;
    for (const m of recent) out += `- [${TAGNAME[m.tag] ?? m.tag}] answered "${m.gave}"\n`;
  }
  return out;
}
