"use client";

import { TAGNAME, qid } from "@cq/content";
import { tagStats } from "@cq/shared";
import type { AnswerRow } from "@/lib/engine";
import { useGameSnapshot } from "@/lib/game-context";

/** Rule-by-rule bars for the rules this round touched, plus a plain reading of the round. */
export function Report({ record, topic }: { record: AnswerRow[]; topic: number }) {
  const { state, bank } = useGameSnapshot();
  const touched = new Set(record.map((r) => r.tag).filter(Boolean));
  const shown = tagStats(state, TAGNAME).filter((s) => touched.has(s.tag));
  const total = bank.filter((q) => q.t === topic).length;
  const done = bank.filter((q) => q.t === topic && state.seen[qid(q)]).length;
  const clean = record.length > 0 && record.every((r) => r.ok);
  return (
    <div className="report">
      <h4>What that round says about you</h4>
      {total > 0 && (
        <div className="exbar">
          <span>Exercises seen</span>
          <span className="meter" aria-hidden="true">
            <i style={{ width: (done / total) * 100 + "%" }} />
          </span>
          <span>
            {done} / {total}
          </span>
        </div>
      )}
      {shown.map((s) => {
        const cls = s.pct >= 90 ? "ok" : s.pct >= 60 ? "mid" : "low";
        return (
          <div key={s.tag} className={"bar " + cls}>
            <span className="nm">
              {s.name}
              {s.pct >= 90 && s.total >= 2 && (
                <span className="acc" role="img" aria-label="mastered">
                  🤝
                </span>
              )}
            </span>
            <span className="sc2">
              {s.right}/{s.total}
            </span>
            <span className="meter" role="img" aria-label={`${s.pct} percent`}>
              <i style={{ width: s.pct + "%" }} />
            </span>
          </div>
        );
      })}
      {!shown.length && <div className="coach-body wait">Play a round to see your rule-by-rule breakdown.</div>}
      <div className="coach">
        <div className="coach-h">
          <i aria-hidden="true">🧑‍🏫</i>
          <b>Coach&apos;s read</b>
        </div>
        <div className="coach-body">
          {clean ? "Clean round, nothing broke. Keep the pace." : "Look at the bars above: anything red is what the next round should hit."}
        </div>
      </div>
    </div>
  );
}
