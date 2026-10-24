"use client";

import { forwardRef, useState, type ReactNode } from "react";
import { TAGNAME } from "@cq/content";
import { calibFor, ruleSplit, tagStats, type Calib } from "@cq/shared";
import { useGame, useGameSnapshot } from "@/lib/game-context";

const FEELWORD: [number, string, string][] = [
  [0, "😶", "No idea at all"],
  [15, "😣", "Lost"],
  [30, "😕", "Shaky"],
  [45, "🤔", "Half there"],
  [60, "🙂", "Getting it"],
  [75, "😃", "Solid"],
  [90, "🤩", "Automatic, no thinking"],
  [100, "🔥", "Wake me from sleep, I'd still know"],
];
export function feelWord(v: number): [number, string, string] {
  let f = FEELWORD[0]!;
  for (const r of FEELWORD) if (v >= r[0]) f = r;
  return f;
}

const names = (tags: string[]) => tags.map((k) => TAGNAME[k] ?? k);

/** The shared target: every rule at 90%+ on my side AND 90%+ on theirs. */
function Accord({ feel }: { feel: number }) {
  const { state } = useGameSnapshot();
  const under = tagStats(state, TAGNAME).filter((s) => s.total >= 2 && s.pct < 90);
  if (!under.length && feel >= 90)
    return (
      <div className="accord">
        🤝 <b>Accord.</b> Every rule you have attempted is at 90% or better, and you say 90%+ too. That is the bar we set. Take the crown rounds and move on.
      </div>
    );
  const mineLeft = under.length
    ? `${under.length} rule${under.length > 1 ? "s" : ""} still under 90% on my side (${under
        .slice(0, 3)
        .map((s) => `${TAGNAME[s.tag] ?? s.tag} ${s.pct}%`)
        .join(", ")})`
    : "every rule is 90%+ on my side";
  return (
    <div className="accord">
      🎯 <b>Target: 90%+ from both of us, on every rule.</b>
      <br />
      {mineLeft}, and {feel >= 90 ? "you are already at 90%+" : `you are at ${feel}%`}. Keep drilling.
    </div>
  );
}

function Verdict({ calib, feel, mine, acc }: { calib: Calib; feel: number; mine: number; acc: number }) {
  const { state } = useGameSnapshot();
  const { strong, weak } = ruleSplit(state);
  const wn = names(weak);
  const sn = names(strong);
  let title: string;
  let body: ReactNode;
  if (calib === "proof") {
    title = `You just scored ${Math.round(acc * 100)}% and rated yourself ${feel}%.`;
    body = (
      <>
        I scored you <b>{mine}%</b>. One of us is reading the round wrong, and it is not me: the answers are on record. So the next drill is not harder and it is not longer: it is built from the rules you have{" "}
        <b>already nailed</b>
        {sn.length ? ` (${sn.slice(0, 3).join(", ")})` : ""}, with two from {wn.length ? wn[0] : "the weak list"} mixed in. Play it, watch yourself get them right, then rate yourself again. Grinding more questions is what taught you to score yourself at {feel}%.
      </>
    );
  } else if (calib === "harder") {
    title = "You're ahead of your record, so the gloves come off.";
    body = (
      <>
        You said <b>{feel}%</b>, I scored you <b>{mine}%</b>. If you feel that solid, the questions were too easy. The next drill moves up a tier
        {sn.length ? ` on ${sn.slice(0, 3).join(", ")}` : ""}: typing, translation and error-spotting instead of tapping an option
        {wn.length ? `, and it still hammers ${wn.slice(0, 2).join(" and ")}.` : "."}
      </>
    );
  } else if (calib === "more") {
    title = "You're harder on yourself than the data is, but we practise anyway.";
    body = (
      <>
        You said <b>{feel}%</b>, I scored you <b>{mine}%</b>. Your call wins: the next drill is <b>volume, not difficulty</b>
        {wn.length ? `, mostly ${wn.slice(0, 3).join(", ")}` : ""}. Same tier, more reps, until it stops feeling like guessing.
      </>
    );
  } else {
    title = "We agree. That means the number is real.";
    body = (
      <>
        You said <b>{feel}%</b>, I scored you <b>{mine}%</b>. The next drill keeps the balance: harder questions where you are clean
        {sn.length ? ` (${sn.slice(0, 3).join(", ")})` : ""}, more questions where you are not{wn.length ? ` (${wn.slice(0, 3).join(", ")})` : ""}.
      </>
    );
  }
  const cls = calib === "harder" ? "hard" : calib === "more" ? "more" : "same";
  return (
    <div className={"fverdict " + cls}>
      <div className="vrow">
        <div className="vcell">
          <b>{feel}%</b>
          <span>You said</span>
        </div>
        <div className="vcell mineu">
          <b>{mine}%</b>
          <span>I say</span>
        </div>
      </div>
      <div className="vtitle">{title}</div>
      <div className="vbody">{body}</div>
      <Accord feel={feel} />
    </div>
  );
}

/** You rate yourself first; my number stays sealed until you lock yours, and the gap sets the next drill. */
export const FeelMeter = forwardRef<
  HTMLInputElement,
  { mine: number; accuracy: number; locked: boolean; onLocked: () => void }
>(function FeelMeter({ mine, accuracy, locked, onLocked }, ref) {
  const { store } = useGame();
  const { state } = useGameSnapshot();
  const [value, setValue] = useState(() => state.feel ?? 50);
  const [calib, setCalib] = useState<Calib | null>(null);
  const [f, face, word] = feelWord(value);
  void f;
  const own = tagStats(state, TAGNAME).filter((s) => s.total >= 2 && s.pct >= 90);

  const lock = () => {
    const next = calibFor(value, mine);
    store.update((d) => {
      d.feel = value;
      d.calib = next;
      d.feelLog = [...d.feelLog, { at: Date.now(), feel: value, mine, r: d.rounds }].slice(-20);
    });
    setCalib(next);
    onLocked();
  };

  return (
    <div className="feel">
      <p className="fq">How well do you feel you understood that? Drag it. I won&apos;t show my number until you lock yours.</p>
      {own.length > 0 && (
        <div className="owned">
          <b>Already yours</b>
          {own.map((s) => (
            <span key={s.tag} className="ownpill">
              {s.name} <i>{s.right}/{s.total}</i>
            </span>
          ))}
        </div>
      )}
      <div className="feelhead" aria-hidden="true">
        <span className="feelface">{face}</span>
        <span className="feelpct">{value}%</span>
      </div>
      <div className="feelword" aria-hidden="true">
        {word}
      </div>
      <input
        ref={ref}
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        disabled={locked}
        aria-label="How well you feel you understood that round, in percent"
        aria-valuetext={`${value} percent. ${word}`}
        onChange={(e) => setValue(+e.target.value)}
      />
      <div className="feelticks" aria-hidden="true">
        <span>No idea</span>
        <span>Shaky</span>
        <span>Solid</span>
        <span>Automatic</span>
      </div>
      {!locked && (
        <button type="button" className="go" onClick={lock}>
          Lock it in
        </button>
      )}
      {locked && calib && <Verdict calib={calib} feel={value} mine={mine} acc={accuracy} />}
    </div>
  );
});
