"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { myRate } from "@cq/shared";
import type { RoundEngine } from "@/lib/engine";
import { useGame, useGameSnapshot, useHostSnapshot } from "@/lib/game-context";
import { progressText } from "@/lib/progress-text";
import { FeelMeter } from "./FeelMeter";
import { useFresh } from "./FreshButton";
import { Report } from "./Report";
import { SayList } from "./SayList";

/** Older browsers and non-secure pages have no async clipboard. */
function legacyCopy(text: string): boolean {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    ta.remove();
  }
}

function Results({ engine }: { engine: RoundEngine }) {
  const { store } = useGame();
  const { state, bank } = useGameSnapshot();
  const hs = useHostSnapshot();
  const snap = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const { busy, run } = useFresh();
  const [locked, setLocked] = useState(false);
  const [feelOpen, setFeelOpen] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");
  const slider = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);

  // my honest rating, taken once when the results show
  const [mine] = useState(() => engine.mine ?? (engine.mine = myRate(store.state, snap.record)));

  const n = snap.qs.length;
  const crowned = !!snap.outcome?.crowned;
  const perfect = !!snap.outcome?.perfect;
  const crowns = state.crowns[snap.topic] ?? 0;
  const icon = crowned ? "👑" : perfect ? "🥐" : snap.hearts > 0 ? "✨" : "💪";
  const title = crowned ? "Crown earned!" : snap.hearts > 0 ? "Round complete" : "Out of hearts";
  const sub = crowned
    ? `Topic ${snap.topic} is now at ${crowns} of 5 crowns.`
    : snap.hearts > 0
      ? perfect
        ? n >= 8
          ? "Flawless. A croissant for you."
          : "Flawless."
        : "Solid. One more gets you closer."
      : "No damage done. The questions come back.";
  const accuracy = snap.record.length ? snap.record.filter((r) => r.ok).length / snap.record.length : 0;

  const drill = () => {
    if (!locked) {
      // the drill is built from your own number, so that comes first
      setFeelOpen(true);
      setHint("Lock in how you feel first. The drill is built from the gap between your number and mine.");
      requestAnimationFrame(() => slider.current?.focus());
      return;
    }
    setHint(null);
    void run();
  };

  const copy = async () => {
    const text = progressText(store.state, bank);
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
    } catch {
      setCopied(legacyCopy(text) ? "ok" : "fail");
    }
    setTimeout(() => setCopied("idle"), 2200);
  };

  return (
    <div className="done">
      <div className="trophy" aria-hidden="true">
        {icon}
      </div>
      <h2 ref={heading} tabIndex={-1}>
        {title}
      </h2>
      <p className="sub">{sub}</p>

      <div className="scores" role="group" aria-label="Round score">
        <div className="sc">
          <b>+{snap.xp}</b>
          <span>XP</span>
        </div>
        <div className="sc">
          <b>
            {snap.right}/{n}
          </b>
          <span>Correct</span>
        </div>
        <div className="sc">
          <b>{snap.best}</b>
          <span>Best combo</span>
        </div>
      </div>
      {crowned && (
        <div className="crownwin">
          <span aria-hidden="true">{"👑".repeat(crowns)}</span> Crown {crowns} of 5
        </div>
      )}

      <div className="row2 col">
        <button type="button" className="go" disabled={busy} aria-busy={busy} onClick={drill}>
          {busy ? "Claude is writing 8 questions…" : "⚡ Drill my weak spots"}
        </button>
        <button type="button" className="go alt" onClick={() => void copy()}>
          {copied === "ok" ? "✓ Copied. Paste it to Claude" : copied === "fail" ? "Copy failed" : "📋 Copy progress for Claude"}
        </button>
        <Link href="/" className="go alt">
          Back to the map
        </Link>
      </div>
      <p className="sub" role="status">
        {hint ?? hs.note ?? ""}
      </p>

      <details className="fold" open={feelOpen} onToggle={(e) => setFeelOpen(e.currentTarget.open)}>
        <summary>
          <span>
            Your call first
            <small>{locked ? "Locked in" : "Rate how well you understood it. This builds your drill."}</small>
          </span>
        </summary>
        <div className="fold-body">
          <FeelMeter ref={slider} mine={mine} accuracy={accuracy} locked={locked} onLocked={() => setLocked(true)} />
        </div>
      </details>

      {locked && (
        <details className="fold">
          <summary>
            <span>
              What that round says about you
              <small>Rule-by-rule bars and a plain reading</small>
            </span>
          </summary>
          <div className="fold-body">
            <Report record={snap.record} topic={snap.topic} />
          </div>
        </details>
      )}

      <details className="fold">
        <summary>
          <span>
            Say it out loud
            <small>{snap.record.length} sentences with Eng, Gujarati and Hindi readings</small>
          </span>
        </summary>
        <div className="fold-body">
          <SayList record={snap.record} />
        </div>
      </details>
    </div>
  );
}

export function ResultsScreen() {
  const { last } = useHostSnapshot();
  if (!last)
    return (
      <div className="done">
        <div className="trophy" aria-hidden="true">
          🥐
        </div>
        <h2>No round to show</h2>
        <p className="sub">Finish a round and your score appears here.</p>
        <Link href="/" className="go">
          Back to the map
        </Link>
      </div>
    );
  return <Results key={last.id} engine={last} />;
}
