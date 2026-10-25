"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";
import { qid } from "@cq/content";
import { SEEN_CAP, xpFor } from "@cq/shared";
import { AUTO_MS, HEARTS, type AnswerRow, type RoundEngine } from "@/lib/engine";
import { useSettings } from "@/lib/game-context";
import { PronRows } from "./PronRows";
import { KIND_LABEL, QuestionBody } from "./Questions";
import { WhyCard } from "./WhyCard";

const CHEERS = ["Bien !", "Oui !", "Parfait !", "Exact !", "Bravo !", "Nickel !"];

function ComboLine({ combo }: { combo: number }) {
  const cls = combo >= 8 ? " blaze" : combo >= 5 ? " hot" : "";
  const text = combo >= 8 ? `🔥🔥 ${combo} EN FEU !` : combo >= 5 ? `🔥 ${combo} in a row` : `✨ ${combo} in a row`;
  return (
    <div className={"combo" + (combo >= 2 ? " on" + cls : "")} aria-hidden="true">
      {combo >= 2 ? text : ""}
    </div>
  );
}

function OkStrip({
  row,
  held,
  study,
  onHold,
  holdRef,
}: {
  row: AnswerRow;
  held: boolean;
  study: boolean;
  onHold: () => void;
  holdRef: RefObject<HTMLButtonElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, []);
  return (
    <div ref={ref} className={"okstrip" + (held ? "" : " fast")} onClick={held ? undefined : onHold} style={{ "--cd": AUTO_MS + "ms" } as CSSProperties}>
      <div className="say" lang="fr">
        {row.full}
      </div>
      <PronRows pr={row.pr} />
      {held ? (
        <div className="hold">{study ? "Say it out loud, then continue." : "Held. Take your time."}</div>
      ) : (
        <>
          <div className="cd" aria-hidden="true">
            <i />
          </div>
          <button
            ref={holdRef}
            type="button"
            className="holdbtn"
            onClick={(e) => {
              e.stopPropagation();
              onHold();
            }}
          >
            Tap this card to keep it on screen
          </button>
        </>
      )}
    </div>
  );
}

/** One question: keyed by index, so every question starts with clean local state. */
function QuestionPanel({ engine }: { engine: RoundEngine }) {
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const { pace } = useSettings();
  const q = snap.qs[snap.i]!;
  const view = engine.view(snap.i);
  const [draft, setDraft] = useState<string | null>(null);
  const [cheer] = useState(() => CHEERS[(Math.random() * CHEERS.length) | 0]!);
  const head = useRef<HTMLHeadingElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hold = useRef<HTMLButtonElement>(null);
  const cont = useRef<HTMLButtonElement>(null);

  const instant = q.k === "choice" || q.k === "fr2en";
  const answered = snap.phase !== "asking";

  // focus follows the flow: the question, then the control that moves on
  useEffect(() => {
    if (snap.phase === "asking") (input.current ?? head.current)?.focus({ preventScroll: true });
    else if (snap.phase === "correct") hold.current?.focus({ preventScroll: true });
    else if (snap.phase === "held") cont.current?.focus({ preventScroll: true });
  }, [snap.phase]);

  const row = snap.record[snap.record.length - 1];
  const showOk = (snap.phase === "correct" || snap.phase === "held") && snap.ok && row;

  return (
    <div className="qwrap" data-qid={qid(q)} data-kind={q.k}>
      <h2 className="qkind" tabIndex={-1} ref={head}>
        {KIND_LABEL[q.k]}
      </h2>
      {engine.isRepeat(q) && (
        <p className="repeat">
          <span aria-hidden="true">↻ </span>Repeat: you have seen this one {SEEN_CAP} times
        </p>
      )}
      <QuestionBody
        q={q}
        view={view}
        answered={answered}
        picked={snap.picked}
        inputRef={input}
        onAnswer={(v) => engine.answer(v)}
        onDraft={setDraft}
        onSubmit={() => engine.answer(draft)}
      />
      {showOk && <OkStrip row={row} held={snap.phase === "held"} study={pace === "study"} onHold={() => engine.hold()} holdRef={hold} />}

      {!instant && snap.phase === "asking" && (
        <button type="button" className="go" disabled={!draft} onClick={() => engine.answer(draft)}>
          Check
        </button>
      )}
      {snap.phase === "correct" && (
        <div className="go cheer" aria-hidden="true">
          {cheer}
        </div>
      )}
      {snap.phase === "held" && (
        <button ref={cont} type="button" className="go continue" onClick={() => engine.next()}>
          Continue →
        </button>
      )}
    </div>
  );
}

/** What a screen reader hears after each step. */
function announce(snap: ReturnType<RoundEngine["getSnapshot"]>): string {
  const n = snap.qs.length;
  const q = snap.qs[snap.i]!;
  const row = snap.record[snap.record.length - 1];
  if (snap.phase === "asking") return `Question ${snap.i + 1} of ${n}. ${KIND_LABEL[q.k]}.`;
  if (snap.phase === "correct" || snap.phase === "held") return `Correct! Plus ${xpFor(snap.combo)} XP. ${row?.full ?? ""}`;
  if (snap.phase === "wrong" || snap.phase === "why")
    return `${snap.accentsOnly ? "So close, check the accents." : "Not quite."} ${snap.hearts} of ${HEARTS} hearts left.`;
  return "";
}

export function RoundView({ engine, onQuit, onDone }: { engine: RoundEngine; onQuit: () => void; onDone: () => void }) {
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const [hit, setHit] = useState(false);

  useEffect(() => {
    if (snap.phase === "done") onDone();
  }, [snap.phase, onDone]);

  useEffect(() => {
    if (snap.phase !== "wrong") return;
    setHit(true);
    const t = setTimeout(() => setHit(false), 320);
    return () => clearTimeout(t);
  }, [snap.phase, snap.rev]);

  const q = snap.qs[snap.i]!;
  const pct = snap.phase === "finishing" || snap.phase === "done" ? 100 : (snap.i / snap.qs.length) * 100;

  return (
    <section className={"round" + (hit ? " hit" : "") + (snap.combo >= 5 ? " glow" : "")} aria-label="Round">
      <div className="rbar">
        <button type="button" className="quit" aria-label="Leave round" onClick={onQuit}>
          <span aria-hidden="true">✕</span>
        </button>
        <div className="track" role="progressbar" aria-label="Round progress" aria-valuemin={0} aria-valuemax={snap.qs.length} aria-valuenow={Math.min(snap.i, snap.qs.length)}>
          <div className="fill" style={{ width: pct + "%" }} />
        </div>
        <div className="hearts" role="img" aria-label={`${snap.hearts} of ${HEARTS} hearts left`}>
          {Array.from({ length: HEARTS }, (_, i) => (
            <span key={i} className={i >= snap.hearts ? "gone" : undefined} aria-hidden="true">
              ❤️
            </span>
          ))}
        </div>
      </div>
      <ComboLine combo={snap.combo} />
      <QuestionPanel key={"q-" + snap.i} engine={engine} />
      <div className="sr-only" role="status" aria-live="polite">
        {announce(snap)}
      </div>
      {snap.phase === "why" && (
        <WhyCard key={"why-" + snap.i} q={q} picked={snap.picked} accentsOnly={snap.accentsOnly} onDone={() => engine.next()} />
      )}
    </section>
  );
}
