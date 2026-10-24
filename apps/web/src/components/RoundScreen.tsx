"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TAG, TAGNAME } from "@cq/content";
import { weakTag } from "@cq/shared";
import type { RoundMode } from "@/lib/engine";
import { useGame, useGameSnapshot, useHostSnapshot } from "@/lib/game-context";
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

  useEffect(() => {
    const live = host.adopt(topic, mode);
    if (live) {
      setStage("playing");
    } else if (mode === "normal" && weakTag(store.state)) {
      setStage("boss"); // the boss card comes first
    } else if (mode === "ai") {
      setStage("loading");
      void host.fresh().then((r) => {
        if (r === "ai" || r === "weak") {
          setStage("playing");
          if (r === "weak") router.replace("/round/6?mode=weak");
        } else if (r === "empty") setStage("empty");
      });
    } else {
      setStage(host.startLocal(topic, mode === "weak" ? "weak" : "normal") ? "playing" : "empty");
    }
    return () => host.release();
  }, [host, store, router, topic, mode]);

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
                onClick={() => setStage(host.startLocal(topic, "normal") ? "playing" : "empty")}
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
        {hs.note && hs.engine.mode === "weak" && (
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
            <p>{hs.note ?? "You've used every question 3 times. Come back after a break."}</p>
            <Link href="/" className="go alt">
              Back to the map
            </Link>
          </>
        ) : stage === "loading" ? (
          <p>Claude is writing 8 questions…</p>
        ) : (
          <p>Getting your round ready…</p>
        )}
      </div>
    </section>
  );
}
