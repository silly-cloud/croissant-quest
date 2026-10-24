"use client";

import { useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RULES, TOPICS, qid } from "@cq/content";
import { Rich } from "@/lib/rich";
import { useGame, useGameSnapshot, useHostSnapshot } from "@/lib/game-context";
import { OFFSETS, topicState, type StopState } from "@/lib/map";
import { Sheet } from "./Sheet";
import { FreshButton } from "./FreshButton";

function TopicSheet({ id, name, st, onClose }: { id: number; name: string; st: StopState; onClose: () => void }) {
  const { state, bank } = useGameSnapshot();
  const c = state.crowns[id] ?? 0;
  const pool = bank.filter((q) => q.t === id);
  const seen = pool.filter((q) => state.seen[qid(q)]).length;
  const count = pool.length ? ` · ${pool.length} exercises (${seen} seen)` : "";
  const sub =
    st === "soon"
      ? "This stop isn't built yet. It opens as the course grows."
      : c >= 5
        ? "Mastered. Replay any time to keep it sharp." + count
        : `Crown ${c + 1} of 5 · difficulty rises with each crown` + count;
  const rule = RULES[id];
  return (
    <Sheet label={name} onClose={onClose}>
      <h3>{name}</h3>
      <p className="sub">{sub}</p>
      {rule && (
        <div className="rules">
          <Rich html={rule} />
        </div>
      )}
      <div className="row2">
        {pool.length > 0 && (
          <Link href={`/round/${id}`} className="go" data-autofocus>
            Play a round
          </Link>
        )}
        <button type="button" className="go alt" onClick={onClose} {...(pool.length === 0 ? { "data-autofocus": true } : {})}>
          Close
        </button>
      </div>
    </Sheet>
  );
}

export function MapScreen() {
  const router = useRouter();
  const { host } = useGame();
  const { state, bank } = useGameSnapshot();
  const hs = useHostSnapshot();
  const [open, setOpen] = useState<{ id: number; name: string; st: StopState } | null>(null);

  // a note from an earlier screen (e.g. "every question used") must not follow the learner here
  useEffect(() => host.clearNote(), [host]);

  const done = TOPICS.filter(([id]) => (state.crowns[id] ?? 0) >= 5).length;
  const wc = Object.keys(state.wrong).length;

  return (
    <div className="map">
      <div className="banner">
        <div className="croiss" aria-hidden="true">
          🥐
        </div>
        <h1>Croissant Quest</h1>
        <p>
          {done} of {TOPICS.length} stops cleared · {state.xp} XP
        </p>
      </div>

      <button
        type="button"
        className="weak"
        onClick={() => {
          // never dead: a local drill from your own mistakes, no coach needed
          if (host.startLocal(6, "weak")) router.push("/round/6?mode=weak");
        }}
      >
        <i aria-hidden="true">⚡</i>
        <b>Weak Spots</b>
        <span>
          {wc ? `${wc} question${wc > 1 ? "s" : ""} you've got wrong. Drill them` : "Nothing to fix yet. Play a round first"}
        </span>
      </button>

      <FreshButton />
      <p className="fade" role="status">
        {hs.note ?? ""}
      </p>

      <ol className="path" aria-label="Course map">
        {TOPICS.map(([id, name], i) => {
          const st = topicState(id, state.crowns, bank);
          const crowns = state.crowns[id] ?? 0;
          return (
            <li key={id} className="node" data-st={st} style={{ "--off": `${OFFSETS[i % OFFSETS.length]}px` } as CSSProperties}>
              <button
                type="button"
                className="node-btn"
                disabled={st === "locked"}
                aria-label={`${name}. Stop ${id}. ${st === "done" ? "Cleared." : st === "locked" ? "Locked." : st === "soon" ? "Coming soon." : "Open."} ${crowns} of 5 crowns.`}
                onClick={() => setOpen({ id, name, st })}
              >
                {/* icon and number are drawn by CSS from data-*, so the button's visible text is just the stop name */}
                <span className="disc" aria-hidden="true" data-icon={st === "done" ? "✓" : st === "locked" ? "🔒" : st === "soon" ? "🚧" : "🥐"}>
                  <span className="num" data-num={id} />
                </span>
                <span className="crowns" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((k) => (
                    <span key={k} className={k < crowns ? "on" : undefined}>
                      👑
                    </span>
                  ))}
                </span>
                <span className="nodelabel">{name}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="fade">More stops open as you go 🚇</p>

      {open && <TopicSheet id={open.id} name={open.name} st={open.st} onClose={() => setOpen(null)} />}
    </div>
  );
}
