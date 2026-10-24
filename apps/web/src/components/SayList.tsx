import type { AnswerRow } from "@/lib/engine";
import { PronRows } from "./PronRows";

/** Every sentence from the round, right and wrong, to read back at your own pace. */
export function SayList({ record }: { record: AnswerRow[] }) {
  return (
    <div className="saylist">
      <p>Every sentence from this round. Gujarati and Hindi approximate the French: the u and the nasal vowels have no exact equivalent.</p>
      {record.map((r, i) => (
        <div key={i} className="sayrow">
          <div className="fr2">
            <span className="mk" role="img" aria-label={r.ok ? "right" : "wrong"}>
              {r.ok ? "✅" : "❌"}
            </span>
            <span lang="fr">{r.full}</span>
          </div>
          {r.en && <div className="gloss" lang="en">{r.en}</div>}
          <PronRows pr={r.pr} />
        </div>
      ))}
    </div>
  );
}
