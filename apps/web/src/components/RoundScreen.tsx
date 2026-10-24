"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TAG, TAGNAME } from "@cq/content";
import { weakTag } from "@cq/shared";
import type { RoundMode } from "@/lib/engine";
import { useGame, useGameSnapshot, useHostSnapshot } from "@/lib/game-context";
import { EMPTY_NOTE } from "@/lib/round-host";
import { Rich } from "@/lib/rich";
import { RoundView } from "./RoundView";
import { Sheet } from "./Sheet";

type Stage = "init" | "boss" | "loading" | "empty" | "playing";

/**
 * /round/[topic]?mode=normal|weak|ai. The URL says what the learner wants; this starts it.
 * Leaving the page (Quit, back button, a link) cancels the round and every timer it owns.
 */
export function RoundScreen({ topic, mode }: { topic: number; mode: RoundMode }) {
  const router = useRouter();
  const { host, store } = useGame();
  const { state } = useGameSnapshot();
  const hs = useHostSnapshot();
  const [stage, setStage] = useState<Stage>("init");

  // start a local round; a topic-6 round with repeats may wait for the coach first
  const startLocal = useCallback(
    (m: "normal" | "weak", alive: () => boolean = () => true) => {
      setStage("loading");
      void host.startRound(topic, m).then((e) => {
        if (alive()) setStage(e ? "playing" : "empty");
      });
    },
    [host, topic],
  );

  useEffect(() => {
    let alive = true;
    const live = host.adopt(topic, mode);
    if (live) {
      setStage("playing");
    } else if (mode === "normal" && weakTag(store.state)) {
      setStage("boss"); // the boss card comes first
    } else if (mode === "ai") {
      setStage("loading");
      void host.fresh().then((r) => {
        if (!alive) return; // the learner left while Claude was writing
        if (r === "ai" || r === "weak") {
          setStage("playing");
          if (r === "weak") router.replace("/round/6?mode=weak");
        } else if (r === "empty") setStage("empty");
      });
    } else {
      startLocal(mode === "weak" ? "weak" : "normal", () => alive);
    }
    return () => {
      alive = false;
      host.cancelFresh(); // a coach answer for a page that is gone must change nothing
      host.release();
    };
  }, [host, store, router, topic, mode, startLocal]);

  const quit = useCallback(() => {
    host.quit();
    router.push("/");
  }, [host, router]);
  const finished = useCallback(() => router.push("/results"), [router]);

  if (stage === "boss") {
    const tag = weakTag(state);
    const rule = tag ? TAG[tag] : undefined;
    const h = (tag && state.hist[tag]) || [0, 0];
    return (
      <div className="round">
        {tag && rule && (
          <Sheet label={`Boss rule: ${TAGNAME[tag] ?? tag}`} onClose={() => router.replace("/")}>
            <h3>⚠️ {TAGNAME[tag] ?? tag}</h3>
            <p className="sub">
              You are {h[0]} of {h[0] + h[1]} on this rule. This round hunts it.
            </p>
            <div className="rules">
              <p>
                <Rich html={rule[0]} />
              </p>
              <p>
                <b>
                  <Rich html={rule[1]} />
                </b>
              </p>
            </div>
            <div className="row2">
              <button
                type="button"
                className="go"
                data-autofocus
                onClick={() => startLocal("normal")}
              >
                Allez ! Chasse au boss
              </button>
            </div>
          </Sheet>
        )}
      </div>
    );
  }

  if (stage === "playing" && hs.engine) {
    return (
      <>
        {hs.note && (
          <p className="syncbanner" role="status">
            {hs.note}
          </p>
        )}
        <RoundView engine={hs.engine} onQuit={quit} onDone={finished} />
      </>
    );
  }

  return (
    <section className="round" aria-label="Round">
      <div className="rbar">
        <Link href="/" className="quit" aria-label="Back to the map" onClick={() => host.quit()}>
          <span aria-hidden="true">✕</span>
        </Link>
      </div>
      <div className="card" role="status">
        {stage === "empty" ? (
          <>
            <p>{hs.note ?? EMPTY_NOTE}</p>
            <Link href="/" className="go alt">
              Back to the map
            </Link>
          </>
        ) : stage === "loading" ? (
          <p>{hs.busy && hs.note ? hs.note : mode === "ai" ? "Claude is writing 8 questions…" : "Getting your round ready…"}</p>
        ) : (
          <p>Getting your round ready…</p>
        )}
      </div>
    </section>
  );
}
